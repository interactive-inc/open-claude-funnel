import { expect, test } from "bun:test"
import type { ServerWebSocket } from "bun"
import { FunnelBroadcaster } from "@/gateway/broadcaster"

for (const phase of ["buffer", "send-getter"] as const) {
  test(`replacement from the current socket's ${phase} cannot send the old registration's event`, () => {
    const broadcaster = new FunnelBroadcaster()
    const sent: string[] = []
    let replaced = false
    const replace = () => {
      if (replaced) return
      replaced = true
      broadcaster.removeClient(ws)
      broadcaster.addClient(ws, { channel: "other", connectors: [] })
    }
    const ws = {
      getBufferedAmount() {
        if (phase === "buffer") replace()
        return 0
      },
      get send() {
        if (phase === "send-getter") replace()
        return (payload: string) => {
          sent.push(JSON.parse(payload).content)
          return payload.length
        }
      },
      close() {},
    } as unknown as ServerWebSocket<unknown>
    broadcaster.addClient(ws, { channel: "ops", connectors: [] })
    broadcaster.broadcast("original", { channelId: "ops" })
    expect(sent).toEqual([])
    broadcaster.broadcast("next", { channelId: "other" })
    expect(sent).toEqual(["next"])
  })
}

for (const failure of ["buffer-throw", "send-throw", "send-drop"] as const) {
  test(`${failure} from a replaced registration cannot remove or close its successor`, () => {
    const broadcaster = new FunnelBroadcaster()
    const sent: string[] = []
    let replaced = false
    let closed = 0
    const replace = () => {
      replaced = true
      broadcaster.removeClient(ws)
      broadcaster.addClient(ws, { channel: "other", connectors: [] })
    }
    const ws = {
      getBufferedAmount() {
        if (!replaced && failure === "buffer-throw") {
          replace()
          throw new Error("old buffer failure")
        }
        return 0
      },
      send(payload: string) {
        if (!replaced) {
          replace()
          if (failure === "send-throw") throw new Error("old send failure")
          return 0
        }
        sent.push(JSON.parse(payload).content)
        return payload.length
      },
      close() {
        closed++
      },
    } as unknown as ServerWebSocket<unknown>
    broadcaster.addClient(ws, { channel: "ops", connectors: [] })
    broadcaster.broadcast("original", { channelId: "ops" })
    expect(broadcaster.getClientCount()).toBe(1)
    expect(closed).toBe(0)
    broadcaster.broadcast("next", { channelId: "other" })
    expect(sent).toEqual(["next"])
  })
}

test("replay canceled from buffer inspection sends nothing and claims no later event", () => {
  let canceled = false
  const claims: number[] = []
  const sent: string[] = []
  const broadcaster = new FunnelBroadcaster({
    persistentReplay: {
      loadSince: (since) =>
        [1, 2]
          .filter((offset) => offset > since)
          .map((offset) => ({ offset, content: "offline", exclusive: { ops: null } })),
      claimExclusive: (offset) => {
        claims.push(offset)
        return true
      },
    },
  })
  broadcaster.seedLatestOffset(2)
  const ws = {
    getBufferedAmount() {
      canceled = true
      return 0
    },
    send(payload: string) {
      sent.push(payload)
      return payload.length
    },
  } as unknown as ServerWebSocket<unknown>
  broadcaster.replayToClient(
    ws,
    0,
    { channel: "ops", connectors: [], delivery: "exclusive", subscriberId: "worker" },
    () => canceled,
  )
  expect(sent).toEqual([])
  expect(claims).toEqual([1])
})
