import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

const createFunnel = () =>
  new Funnel({
    connectors: [scheduleConnector()],
    channels: [{ name: "ops", connectors: [{ type: "schedule", name: "timer" }] }],
  })

test.each(["native", "http"] as const)(
  "%s publishing without a connector cannot forge its identity through metadata",
  async (method) => {
    const funnel = createFunnel()
    const log = new MemoryFunnelEventLog()
    const gateway = funnel.gatewayModule({ token: "example-token", eventLog: log })
    const events = gateway.events({ channel: "ops" })
    const meta = {
      channel: "forged",
      channelId: "forged",
      connector: "timer",
      connectorId: "forged",
      thread_ts: "123.456",
    }
    const original = { ...meta }
    try {
      if (method === "native") gateway.emit({ channel: "ops", content: "host input", meta })
      else {
        const response = await gateway.app.request("/channels/ops/publish", {
          method: "POST",
          headers: { authorization: "Bearer example-token", "content-type": "application/json" },
          body: JSON.stringify({ content: "host input", meta }),
        })
        expect(response.status).toBe(200)
      }
      expect(log.loadSince(0)[0]?.meta).toEqual({
        channel: "ops",
        channelId: funnel.channels.get("ops")!.id,
        thread_ts: "123.456",
      })
      expect(meta).toEqual(original)
      expect(
        await Promise.race([events.next(), Bun.sleep(30).then(() => "no delivery")]),
      ).toMatchObject({
        done: false,
        value: { content: "host input" },
      })
      await events.return()
      const replay = gateway.events({ channel: "ops", since: 0 })
      try {
        expect((await replay.next()).value.content).toBe("host input")
      } finally {
        await replay.return()
      }
    } finally {
      await events.return()
      await gateway.stop()
      log.close()
    }
  },
)

test("an explicit connector owns its identity even when metadata supplies different ids", async () => {
  const funnel = createFunnel()
  const gateway = funnel.gatewayModule({ token: "" })
  const events = gateway.events({ channel: "ops" })
  try {
    gateway.emit({
      channel: "ops",
      connector: "timer",
      content: "connector input",
      meta: { connector: "forged", connectorId: "forged" },
    })
    expect((await events.next()).value.meta).toMatchObject({
      connector: "timer",
      connectorId: funnel.channels.getConnector("ops", "timer")!.id,
    })
  } finally {
    await events.return()
    await gateway.stop()
  }
})

test("an unresolved connector label cannot borrow a configured connector id", async () => {
  const funnel = createFunnel()
  const gateway = funnel.gatewayModule({ token: "" })
  try {
    gateway.emit({
      channel: "ops",
      connector: "external-label",
      content: "host input",
      meta: { connectorId: funnel.channels.getConnector("ops", "timer")!.id },
    })
    const stored = gateway.getEventLog().loadSince(0)[0]
    expect(stored?.meta?.connector).toBe("external-label")
    expect(stored?.meta).not.toHaveProperty("connectorId")
  } finally {
    await gateway.stop()
  }
})

test("host metadata cannot add connector-less SQLite records to a connector's history", async () => {
  const funnel = createFunnel()
  const log = new SqliteFunnelEventLog({ path: ":memory:" })
  const gateway = funnel.gatewayModule({ token: "", eventLog: log })
  const channelId = funnel.channels.get("ops")!.id
  const connectorId = funnel.channels.getConnector("ops", "timer")!.id
  try {
    gateway.emit({
      channel: "ops",
      content: "host input",
      meta: { connector: "timer", connectorId },
    })
    expect(log.loadForChannel({ channelId, connectorId })).toEqual([])
    expect(log.loadForChannel({ channelId })).toHaveLength(1)
  } finally {
    await gateway.stop()
    log.close()
  }
})
