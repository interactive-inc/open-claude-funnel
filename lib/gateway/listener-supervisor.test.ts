import { describe, expect, test } from "vitest"
import type { BaseConnectorConfig } from "@/engine/connectors/base-connector-config"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
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

const config: BaseConnectorConfig = {
  id: "co-1",
  type: "schedule",
  name: "cron",
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

  test("startAll starts listeners concurrently — a failing one does not block others", async () => {
    const goodListener = new FakeListener()
    const badConfig: BaseConnectorConfig = { id: "co-2", type: "slack", name: "bad-slack" }
    const badView: ChannelConnectorView = { ...badConfig, channelId: "ch-1", channelName: "ops" }

    class FailingListener extends FunnelConnectorListener {
      async start(): Promise<void> {
        throw new Error("auth failed")
      }
      async stop(): Promise<void> {}
      override isAlive(): boolean {
        return false
      }
    }

    const failingListener = new FailingListener()
    const supervisor = new FunnelListenerSupervisor({
      channels: {
        listAllConnectors: () => [badView, view],
        createListener: (_ch: string, name: string) => {
          if (name === "bad-slack") return { config: badConfig, channelId: "ch-1", listener: failingListener }
          return { config, channelId: "ch-1", listener: goodListener }
        },
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
    })

    await supervisor.startAll()

    expect(supervisor.isRunning("ops", "cron")).toBe(true)
    expect(supervisor.isRunning("ops", "bad-slack")).toBe(false)

    await supervisor.stopAll()
  })

  test("start times out when listener.start() hangs", async () => {
    class HangingListener extends FunnelConnectorListener {
      async start(): Promise<void> {
        await new Promise(() => {})
      }
      async stop(): Promise<void> {}
      override isAlive(): boolean {
        return false
      }
    }

    const listener = new HangingListener()
    const supervisor = new FunnelListenerSupervisor({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      startTimeoutMs: 50,
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    })

    const result = await supervisor.start("ops", "cron")

    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/timed out/)
  })

  test("failed listeners are retried by health check via pendingRetry", async () => {
    let startAttempts = 0

    class EventuallyGoodListener extends FunnelConnectorListener {
      alive = false
      async start(): Promise<void> {
        startAttempts++
        if (startAttempts <= 1) throw new Error("not ready yet")
        this.alive = true
      }
      async stop(): Promise<void> {
        this.alive = false
      }
      override isAlive(): boolean {
        return this.alive
      }
    }

    const listener = new EventuallyGoodListener()
    const supervisor = new FunnelListenerSupervisor({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      healthCheckIntervalMs: 10,
      sleep: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 10))),
    })

    await supervisor.startAll()

    expect(supervisor.isRunning("ops", "cron")).toBe(false)
    expect(startAttempts).toBe(1)

    await new Promise((r) => setTimeout(r, 100))

    expect(supervisor.isRunning("ops", "cron")).toBe(true)
    expect(startAttempts).toBe(2)

    await supervisor.stopAll()
  })

  test("recoverDead really restarts the listener even when stop() throws", async () => {
    class FlakyStopListener extends FunnelConnectorListener {
      alive = false
      startCalls = 0
      stopThrowsLeft = 1

      async start(): Promise<void> {
        this.startCalls += 1
        this.alive = true
      }

      async stop(): Promise<void> {
        this.alive = false

        if (this.stopThrowsLeft > 0) {
          this.stopThrowsLeft -= 1
          throw new Error("stop boom")
        }
      }

      override isAlive(): boolean {
        return this.alive
      }
    }

    const listener = new FlakyStopListener()
    const supervisor = new FunnelListenerSupervisor({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      sleep: async () => {},
      healthCheckIntervalMs: 1,
    })

    await supervisor.start("ops", "cron")
    expect(listener.startCalls).toBe(1)

    listener.alive = false

    await supervisor.runHealthCheckForTest()

    expect(listener.startCalls).toBe(2)
    expect(supervisor.isRunning("ops", "cron")).toBe(true)
  })
})
