import { describe, expect, test } from "bun:test"
import type { ConnectorConfig } from "@/connectors/connector-config-schema"
import { FunnelConnectorListener, type NotifyFn } from "@/connectors/connector-listener"
import type { ChannelConnectorView } from "@/engine/channels/channels"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { FunnelListenerSupervisor } from "@/gateway/listener-supervisor"

class FakeListener extends FunnelConnectorListener {
  alive = false

  async start(_notify: NotifyFn): Promise<void> {
    this.alive = true
  }

  async stop(): Promise<void> {
    this.alive = false
  }

  override isAlive(): boolean {
    return this.alive
  }
}

const config: ConnectorConfig = {
  id: "co-1",
  type: "schedule",
  name: "cron",
  entries: [],
}

const view: ChannelConnectorView = { ...config, channelId: "ch-1", channelName: "ops" }

const buildRegistry = (listener: FakeListener) => ({
  listAllConnectors: () => [view],
  createListener: (channel: string, name: string) => {
    if (channel !== "ops" || name !== "cron") return null

    return { config, channelId: "ch-1", listener }
  },
})

describe("FunnelListenerSupervisor", () => {
  test("startAll boots every connector and list reflects channel/connector identity", async () => {
    const listener = new FakeListener()
    const supervisor = new FunnelListenerSupervisor({
      channels: buildRegistry(listener),
      notify: async () => {},
      logger: new NoopFunnelLogger(),
    })

    await supervisor.startAll()

    const entries = supervisor.list()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.channelName).toBe("ops")
    expect(entries[0]?.channelId).toBe("ch-1")
    expect(entries[0]?.name).toBe("cron")
    expect(supervisor.isRunning("ops", "cron")).toBe(true)

    await supervisor.stopAll()
    expect(supervisor.isRunning("ops", "cron")).toBe(false)
  })

  test("notify is forwarded with the channel and connector arguments", async () => {
    const listener = new FakeListener()
    const seen: { channel: string; connector: string; content: string }[] = []
    const supervisor = new FunnelListenerSupervisor({
      channels: buildRegistry(listener),
      notify: async (channel, connector, content) => {
        seen.push({ channel, connector, content })
      },
      logger: new NoopFunnelLogger(),
    })

    await supervisor.start("ops", "cron")
    listener.alive = true

    const captured: NotifyFn[] = []
    const origStart = listener.start.bind(listener)
    listener.start = async (notify: NotifyFn) => {
      captured.push(notify)
      await origStart(notify)
    }

    await supervisor.restart("ops", "cron")

    if (!captured[0]) throw new Error("expected notify capture")

    await captured[0]("hello", { event_type: "test" })

    expect(seen).toEqual([{ channel: "ops", connector: "cron", content: "hello" }])
  })

  test("start returns an error when the connector cannot be created", async () => {
    const supervisor = new FunnelListenerSupervisor({
      channels: {
        listAllConnectors: () => [],
        createListener: () => null,
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
    })

    const result = await supervisor.start("ops", "missing")

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/not found/)
  })

  test("listener.start() throws are forwarded to onError with context", async () => {
    class ThrowingStartListener extends FunnelConnectorListener {
      async start(): Promise<void> {
        throw new Error("listener boom")
      }
      async stop(): Promise<void> {}
      override isAlive(): boolean {
        return false
      }
    }

    const listener = new ThrowingStartListener()
    const captured: { error: Error; context?: Record<string, unknown> }[] = []
    const supervisor = new FunnelListenerSupervisor({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      onError: (error, context) => captured.push({ error, context }),
    })

    const result = await supervisor.start("ops", "cron")

    expect(result.ok).toBe(false)
    expect(captured.length).toBe(1)
    expect(captured[0]?.error.message).toBe("listener boom")
    expect(captured[0]?.context).toMatchObject({
      component: "listener-supervisor.start",
      channel: "ops",
      connector: "cron",
      type: "schedule",
    })
  })
})
