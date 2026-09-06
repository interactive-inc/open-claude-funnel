import { describe, expect, test } from "bun:test"
import type { BaseConnectorConfig } from "@/engine/connectors/base-connector-config"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import type { ChannelConnectorView } from "@/engine/channels/channels"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { FunnelListenerRegistry } from "@/gateway/listener-registry"

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

describe("FunnelListenerRegistry", () => {
  test("an explicit stop remains stopped until an explicit start", async () => {
    const listener = new FakeListener()
    const registry = new FunnelListenerRegistry({
      channels: buildRegistry(listener),
      notify: async () => {},
      sleep: async () => {},
    })
    await registry.startAll()
    await registry.stop("ops", "cron")
    await registry.runHealthCheckForTest()
    await registry.runHealthCheckForTest()
    expect(registry.isRunning("ops", "cron")).toBe(false)
    expect(listener.alive).toBe(false)
    await registry.start("ops", "cron")
    expect(registry.isRunning("ops", "cron")).toBe(true)
    await registry.stopAll()
  })

  test.each([false, true])(
    "stopAll releases an opening listener even at the registration boundary (%s)",
    async (justOpened) => {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const captured: { notify: NotifyFn | null } = { notify: null }
      class OpeningListener extends FakeListener {
        override async start(notify: NotifyFn): Promise<void> {
          captured.notify = notify
          entered.resolve()
          await release.promise
          this.alive = true
        }
      }
      const listener = new OpeningListener()
      const seen: string[] = []
      const registry = new FunnelListenerRegistry({
        channels: buildRegistry(listener),
        notify: async (_channel, _connector, content) => {
          seen.push(content)
        },
      })
      const starting = registry.startAll()
      await entered.promise
      if (justOpened) {
        release.resolve()
        await Promise.resolve()
        await Promise.resolve()
      }
      const stopping = registry.stopAll()
      release.resolve()
      await Promise.all([starting, stopping])
      expect(listener.alive).toBe(false)
      expect(registry.list()).toEqual([])
      await registry.runHealthCheckForTest()
      expect(registry.list()).toEqual([])
      await expect(captured.notify?.("late event")).rejects.toThrow("listener stopped")
      expect(seen).toEqual([])
    },
  )

  test("a startup that completes after its timeout is closed and cannot notify", async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const timeout = Promise.withResolvers<void>()
    const closedLate = Promise.withResolvers<void>()
    const captured: { notify: NotifyFn | null } = { notify: null }
    class LateListener extends FakeListener {
      override async start(notify: NotifyFn): Promise<void> {
        captured.notify = notify
        entered.resolve()
        await release.promise
        this.alive = true
      }
      override async stop(): Promise<void> {
        if (this.alive) closedLate.resolve()
        this.alive = false
      }
    }
    const listener = new LateListener()
    const registry = new FunnelListenerRegistry({
      channels: buildRegistry(listener),
      notify: async () => {},
      sleep: () => timeout.promise,
    })
    const starting = registry.start("ops", "cron")
    await entered.promise
    timeout.resolve()
    expect((await starting).ok).toBe(false)
    release.resolve()
    await closedLate.promise
    expect(listener.alive).toBe(false)
    expect(registry.list()).toEqual([])
    await expect(captured.notify?.("late")).rejects.toThrow("listener stopped")
    await registry.stopAll()
  })

  test.each(["stop", "stopAll"])(
    "%s cancels a recovery already sleeping in backoff",
    async (operation) => {
      const sleeping = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const listener = new FakeListener()
      const registry = new FunnelListenerRegistry({
        channels: buildRegistry(listener),
        notify: async () => {},
        sleep: (ms) => {
          if (ms === 30_000) return new Promise(() => {})
          sleeping.resolve()
          return release.promise
        },
      })
      await registry.start("ops", "cron")
      listener.alive = false
      const recovery = registry.runHealthCheckForTest()
      await sleeping.promise
      if (operation === "stop") await registry.stop("ops", "cron")
      else await registry.stopAll()
      release.resolve()
      await recovery
      expect(listener.alive).toBe(false)
      expect(registry.list()).toEqual([])
      await registry.stopAll()
    },
  )

  test("startAll does not create a listener for channels without connectors", async () => {
    let createListenerCalls = 0
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [],
        createListener: () => {
          createListenerCalls += 1
          return null
        },
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
    })

    await registry.startAll()

    expect(createListenerCalls).toBe(0)
    expect(registry.list()).toEqual([])
  })

  test("startAll boots every connector and list reflects channel/connector identity", async () => {
    const listener = new FakeListener()
    const registry = new FunnelListenerRegistry({
      channels: buildRegistry(listener),
      notify: async () => {},
      logger: new NoopFunnelLogger(),
    })

    await registry.startAll()

    const entries = registry.list()

    expect(entries).toHaveLength(1)
    expect(entries[0]?.channelName).toBe("ops")
    expect(entries[0]?.channelId).toBe("ch-1")
    expect(entries[0]?.name).toBe("cron")
    expect(registry.isRunning("ops", "cron")).toBe(true)

    await registry.stopAll()
    expect(registry.isRunning("ops", "cron")).toBe(false)
  })

  test("notify is forwarded with the channel and connector arguments", async () => {
    const listener = new FakeListener()
    const seen: { channel: string; connector: string; content: string }[] = []
    const registry = new FunnelListenerRegistry({
      channels: buildRegistry(listener),
      notify: async (channel, connector, content) => {
        seen.push({ channel, connector, content })
      },
      logger: new NoopFunnelLogger(),
    })

    await registry.start("ops", "cron")
    listener.alive = true

    const captured: NotifyFn[] = []
    const origStart = listener.start.bind(listener)
    listener.start = async (notify: NotifyFn) => {
      captured.push(notify)
      await origStart(notify)
    }

    await registry.restart("ops", "cron")

    if (!captured[0]) throw new Error("expected notify capture")

    await captured[0]("hello", { event_type: "test" })

    expect(seen).toEqual([{ channel: "ops", connector: "cron", content: "hello" }])
  })

  test("start returns an error when the connector cannot be created", async () => {
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [],
        createListener: () => null,
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
    })

    const result = await registry.start("ops", "missing")

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
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      onError: (error, context) => captured.push({ error, context }),
    })

    const result = await registry.start("ops", "cron")

    expect(result.ok).toBe(false)
    expect(captured.length).toBe(1)
    expect(captured[0]?.error.message).toBe("listener boom")
    expect(captured[0]?.context).toMatchObject({
      component: "listener-registry.start",
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
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [badView, view],
        createListener: (_ch: string, name: string) => {
          if (name === "bad-slack")
            return { config: badConfig, channelId: "ch-1", listener: failingListener }
          return { config, channelId: "ch-1", listener: goodListener }
        },
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
    })

    await registry.startAll()

    expect(registry.isRunning("ops", "cron")).toBe(true)
    expect(registry.isRunning("ops", "bad-slack")).toBe(false)

    await registry.stopAll()
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
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      startTimeoutMs: 50,
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    })

    const result = await registry.start("ops", "cron")

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
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      startTimeoutMs: 50,
      sleep: (ms: number) => new Promise((r) => setTimeout(r, ms)),
    })

    await registry.start("ops", "cron")

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
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
    })

    await registry.start("ops", "cron")

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
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      healthCheckIntervalMs: 10,
      sleep: (ms: number) => new Promise((r) => setTimeout(r, Math.min(ms, 10))),
    })

    await registry.startAll()

    expect(registry.isRunning("ops", "cron")).toBe(false)
    expect(startAttempts).toBe(1)

    await new Promise((r) => setTimeout(r, 100))

    expect(registry.isRunning("ops", "cron")).toBe(true)
    expect(startAttempts).toBe(2)

    await registry.stopAll()
  })

  test("restart retries a transient start failure instead of losing the listener", async () => {
    let startAttempts = 0

    class FailsFirstRestartListener extends FunnelConnectorListener {
      alive = false

      async start(): Promise<void> {
        startAttempts += 1

        if (startAttempts === 2) throw new Error("temporary socket close")

        this.alive = true
      }

      async stop(): Promise<void> {
        this.alive = false
      }

      override isAlive(): boolean {
        return this.alive
      }
    }

    const listener = new FailsFirstRestartListener()
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      sleep: async () => {},
    })

    await registry.start("ops", "cron")

    const restarted = await registry.restart("ops", "cron")

    expect(restarted.ok).toBe(false)
    expect(registry.isRunning("ops", "cron")).toBe(false)

    await registry.runHealthCheckForTest()

    expect(startAttempts).toBe(3)
    expect(registry.isRunning("ops", "cron")).toBe(true)

    await registry.stopAll()
  })

  test("dead-listener recovery retries when its replacement fails to start", async () => {
    let startAttempts = 0

    class FailsFirstRecoveryListener extends FunnelConnectorListener {
      alive = false

      async start(): Promise<void> {
        startAttempts += 1

        if (startAttempts === 2) throw new Error("network unavailable")

        this.alive = true
      }

      async stop(): Promise<void> {
        this.alive = false
      }

      override isAlive(): boolean {
        return this.alive
      }
    }

    const listener = new FailsFirstRecoveryListener()
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      sleep: async () => {},
    })

    await registry.start("ops", "cron")
    listener.alive = false

    await registry.runHealthCheckForTest()

    expect(startAttempts).toBe(3)
    expect(registry.isRunning("ops", "cron")).toBe(true)

    await registry.stopAll()
  })

  test("health check recreates a configured listener missing from runtime state", async () => {
    const listener = new FakeListener()
    const registry = new FunnelListenerRegistry({
      channels: buildRegistry(listener),
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      sleep: async () => {},
    })

    expect(registry.isRunning("ops", "cron")).toBe(false)

    await registry.runHealthCheckForTest()

    expect(registry.isRunning("ops", "cron")).toBe(true)

    await registry.stopAll()
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
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [view],
        createListener: () => ({ config, channelId: "ch-1", listener }),
      },
      notify: async () => {},
      logger: new NoopFunnelLogger(),
      sleep: async () => {},
      healthCheckIntervalMs: 1,
    })

    await registry.start("ops", "cron")
    expect(listener.startCalls).toBe(1)

    listener.alive = false

    await registry.runHealthCheckForTest()

    expect(listener.startCalls).toBe(2)
    expect(registry.isRunning("ops", "cron")).toBe(true)
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

    const registry = new FunnelListenerRegistry({
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

    await registry.startAll()
    expect(attempts).toBe(1)

    // Run two health-check passes — a retriable failure would queue a
    // retry per pass and bump attempts up; auth-failed must be dropped
    // from the queue so attempts stays at 1.
    await registry.runHealthCheckForTest()
    await registry.runHealthCheckForTest()

    expect(attempts).toBe(1)

    await registry.stopAll()
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

    const registry = new FunnelListenerRegistry({
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

    await registry.startAll()

    // Wipe restart timings from the initial start
    restartTimes = []

    listenerA.alive = false
    listenerB.alive = false

    await registry.runHealthCheckForTest()

    expect(restartTimes).toHaveLength(2)
    const gap = Math.abs((restartTimes[1] ?? 0) - (restartTimes[0] ?? 0))
    expect(gap).toBeLessThan(10)

    await registry.stopAll()
  })
})
