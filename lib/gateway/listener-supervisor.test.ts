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

  test("listener.stop() is called when start() times out to prevent resource leaks", async () => {
    let stopped = false

    class HangingListener extends FunnelConnectorListener {
      async start(): Promise<void> {
        await new Promise(() => {})
      }
      async stop(): Promise<void> {
        stopped = true
      }
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

    await supervisor.start("ops", "cron")

    expect(stopped).toBe(true)
  })

  test("listener.stop() is called when start() throws to prevent resource leaks", async () => {
    let stopped = false

    class FailAndLeakListener extends FunnelConnectorListener {
      async start(): Promise<void> {
        throw new Error("start failed")
      }
      async stop(): Promise<void> {
        stopped = true
      }
      override isAlive(): boolean {
        return false
      }
    }

    const listener = new FailAndLeakListener()
    const supervisor = new FunnelListenerSupervisor({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
    })

    await supervisor.start("ops", "cron")

    expect(stopped).toBe(true)
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

  test("recoverDead re-queues the listener when start() fails so it is not orphaned", async () => {
    // Regression for #18: when recoverDead's restart attempt failed, the
    // listener was dropped from `running` by stop() but never added to
    // `pendingRetry`, so the health-check loop never touched it again.
    class RestartFailsOnceListener extends FunnelConnectorListener {
      alive = false
      startCalls = 0
      /** start #1 ok, #2 (recoverDead retry) throws, #3 (pendingRetry retry) ok. */
      async start(): Promise<void> {
        this.startCalls += 1
        if (this.startCalls === 2) throw new Error("transient connect failure")
        this.alive = true
      }
      async stop(): Promise<void> {
        this.alive = false
      }
      override isAlive(): boolean {
        return this.alive
      }
    }

    const listener = new RestartFailsOnceListener()
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
    expect(supervisor.isRunning("ops", "cron")).toBe(true)
    expect(listener.startCalls).toBe(1)

    // Simulate the upstream connection dropping (e.g. Slack WS disconnect).
    // One tick walks `running` (recoverDead's start #2 throws) and then
    // `pendingRetry` (start #3 succeeds). Before the fix start #2's failure
    // would leave the listener in neither map and isRunning would stay false.
    listener.alive = false

    await supervisor.runHealthCheckForTest()

    expect(supervisor.isRunning("ops", "cron")).toBe(true)
    expect(listener.startCalls).toBe(3)

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

  test("FunnelAuthFailedError is not retried (token rotation needs operator action)", async () => {
    const { FunnelAuthFailedError } = await import("@/engine/error/funnel-error")

    let attempts = 0
    class AuthFailingListener extends FunnelConnectorListener {
      async start(): Promise<void> {
        attempts += 1
        throw new FunnelAuthFailedError("slack", "invalid_auth")
      }
      async stop(): Promise<void> {}
      override isAlive(): boolean {
        return false
      }
    }

    const supervisor = new FunnelListenerSupervisor({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({
          config,
          channelId: "ch-1",
          listener: new AuthFailingListener(),
        }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      healthCheckIntervalMs: 1,
      sleep: async () => {},
    })

    await supervisor.startAll()
    expect(attempts).toBe(1)

    // Run two health-check passes — a retriable failure would queue a
    // retry per pass and bump attempts up; auth-failed must be dropped
    // from the queue so attempts stays at 1.
    await supervisor.runHealthCheckForTest()
    await supervisor.runHealthCheckForTest()

    expect(attempts).toBe(1)

    await supervisor.stopAll()
  })

  test("recoverDead runs in parallel — a slow restart does not block sibling restarts", async () => {
    // Two listeners go dead at the same time. With the sequential loop the
    // second one's recovery would wait for the first one's backoff sleep
    // (default sleep is 0 in this test, but recoverDead awaits anyway).
    // Parallel recovery starts both within the same microtask.

    let restartTimes: number[] = []

    class TrackedListener extends FunnelConnectorListener {
      alive = true
      async start(): Promise<void> {
        restartTimes.push(Date.now())
        this.alive = true
      }
      async stop(): Promise<void> {
        this.alive = false
      }
      override isAlive(): boolean {
        return this.alive
      }
    }

    const listenerA = new TrackedListener()
    const listenerB = new TrackedListener()

    const supervisor = new FunnelListenerSupervisor({
      channels: {
        listAllConnectors: () => [
          { ...view, name: "a" },
          { ...view, name: "b" },
        ],
        createListener: (_channelName: string, connectorName: string) => ({
          config: { ...config, name: connectorName },
          channelId: "ch-1",
          listener: connectorName === "a" ? listenerA : listenerB,
        }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      healthCheckIntervalMs: 1,
      // sleep returns after a real ~5ms so we can observe overlap; if
      // recoverDead were sequential, B would only fire after A's sleep
      // completes — i.e. ≥10ms apart instead of within a few ms.
      sleep: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 5))),
    })

    await supervisor.startAll()

    // Wipe restart timings from the initial start
    restartTimes = []

    listenerA.alive = false
    listenerB.alive = false

    await supervisor.runHealthCheckForTest()

    expect(restartTimes).toHaveLength(2)
    const gap = Math.abs((restartTimes[1] ?? 0) - (restartTimes[0] ?? 0))
    expect(gap).toBeLessThan(10)

    await supervisor.stopAll()
  })
})
