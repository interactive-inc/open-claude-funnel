import { expect, test } from "bun:test"
import type { ServerWebSocket } from "bun"
import { Funnel } from "@/funnel"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import type { GatewayWsData } from "@/gateway/gateway-module"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"

for (const delivery of ["fanout", "exclusive"] as const) {
  for (const phase of ["load", "send"] as const) {
    test(`${delivery} WebSocket handoff retains a publication during replay ${phase}`, async () => {
      let onLoad = () => {}
      class HostLog extends MemoryFunnelEventLog {
        override loadSince(since: number, limit?: number) {
          onLoad()
          return super.loadSince(since, limit)
        }
      }
      const funnel = new Funnel({ channels: [{ name: "ops", delivery }] })
      const channel = funnel.channels.get("ops")!
      const log = new HostLog()
      log.record({
        offset: 1,
        content: "history",
        channelId: channel.id,
        connectorId: null,
        meta: null,
        ...(delivery === "exclusive" ? { exclusive: { [channel.id]: null } } : {}),
      })
      const gateway = funnel.gatewayModule({ token: "", eventLog: log })
      let published = false
      const publish = () => {
        if (published) return
        published = true
        gateway.emit({ channel: "ops", content: "during replay" })
      }
      if (phase === "load") onLoad = publish
      const received: { content: string; offset: number }[] = []
      let readyState = 1
      const socket = {
        get readyState() {
          return readyState
        },
        data: {
          channel: channel.id,
          channelName: "ops",
          connectors: [],
          connectorIds: [],
          delivery,
          subscriberId: "worker",
          since: 0,
        },
        send(payload: string) {
          received.push(JSON.parse(payload))
          if (phase === "send") publish()
          return payload.length
        },
        getBufferedAmount: () => 0,
        close() {
          readyState = 3
        },
      } as unknown as ServerWebSocket<GatewayWsData>
      try {
        gateway.websocket.open!(socket)
        gateway.emit({ channel: "ops", content: "after replay" })
        expect(received.map(({ content, offset }) => [content, offset])).toEqual([
          ["history", 1],
          ["during replay", 2],
          ["after replay", 3],
        ])
        expect(gateway.getStatus().clients).toBe(1)
      } finally {
        onLoad = () => {}
        await gateway.stop()
      }
    })
  }
}

test("live input queued during WebSocket replay obeys the byte cap and drops a slow client", () => {
  let closed: number | undefined
  const sent: string[] = []
  const broadcaster = new FunnelBroadcaster({
    replayBufferSize: 0,
    maxBufferedBytes: 128,
    persistentReplay: {
      loadSince() {
        broadcaster.broadcast("x".repeat(256), { channelId: "channel" })
        return [{ content: "history", offset: 1, meta: { channelId: "channel" } }]
      },
    },
  })
  broadcaster.seedLatestOffset(1)
  const socket = {
    send(payload: string) {
      sent.push(payload)
      return payload.length
    },
    getBufferedAmount: () => 0,
    close(code: number) {
      closed = code
    },
  } as unknown as ServerWebSocket<unknown>
  broadcaster.addClient(socket, { channel: "channel", connectors: [] }, { since: 0 })
  expect(sent).toEqual([])
  expect(closed).toBe(1009)
  expect(broadcaster.getClientCount()).toBe(0)
  expect(broadcaster.getMetrics().droppedSlowClients).toBe(1)
})

test("a failed WebSocket replay discards queued live input and removes the registration", () => {
  const failure = new Error("history failed")
  const sent: string[] = []
  const broadcaster = new FunnelBroadcaster({
    replayBufferSize: 0,
    persistentReplay: {
      loadSince() {
        broadcaster.broadcast("during replay", { channelId: "channel" })
        throw failure
      },
    },
  })
  broadcaster.seedLatestOffset(1)
  const socket = {
    send(payload: string) {
      sent.push(payload)
      return payload.length
    },
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<unknown>
  expect(() =>
    broadcaster.addClient(socket, { channel: "channel", connectors: [] }, { since: 0 }),
  ).toThrow(failure)
  broadcaster.broadcast("after replay", { channelId: "channel" })
  expect(sent).toEqual([])
  expect(broadcaster.getClientCount()).toBe(0)
})

for (const action of ["replace", "send-failure"] as const) {
  test(`${action} during WebSocket replay cannot retain the old live queue`, () => {
    const sent: string[] = []
    const failure = new Error("send failed")
    const broadcaster = new FunnelBroadcaster({
      replayBufferSize: 0,
      persistentReplay: {
        loadSince(since) {
          if (since >= 1) return []
          broadcaster.broadcast("queued", { channelId: "channel" })
          return [{ content: "history", offset: 1, meta: { channelId: "channel" } }]
        },
      },
    })
    broadcaster.seedLatestOffset(1)
    const socket = {
      send(payload: string) {
        const content = JSON.parse(payload).content
        if (content === "queued" && action === "send-failure") throw failure
        sent.push(content)
        if (content === "history" && action === "replace")
          broadcaster.addClient(socket, { channel: "other", connectors: [] })
        return payload.length
      },
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<unknown>
    const connect = () =>
      broadcaster.addClient(socket, { channel: "channel", connectors: [] }, { since: 0 })
    if (action === "send-failure") expect(connect).toThrow(failure)
    else connect()
    broadcaster.broadcast("after", { channelId: "other" })
    expect(sent).toEqual(action === "replace" ? ["history", "after"] : ["history"])
    expect(broadcaster.getClientCount()).toBe(action === "replace" ? 1 : 0)
    broadcaster.closeClients()
  })
}
