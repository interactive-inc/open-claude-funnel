import { describe, expect, test } from "bun:test"
import type { ChannelConnectorView } from "@/engine/channels/channels"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelAuthFailedError } from "@/engine/error/funnel-error"
import { Funnel } from "@/funnel"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"

const connection = (
  channelName = "ops",
  name = "inbox",
  id = "source-1",
  channelId = "channel-1",
): ChannelConnectorView => ({
  channelId,
  channelName,
  id,
  name,
  type: "test",
})

class Listener extends FunnelConnectorListener {
  alive = false
  stopped = 0
  notify?: NotifyFn
  async start(notify: NotifyFn): Promise<void> {
    this.notify = notify
    this.alive = true
  }
  async stop(): Promise<void> {
    this.alive = false
    this.stopped++
  }
  override isAlive(): boolean {
    return this.alive
  }
  send(content: string): Promise<void> {
    return this.notify!(content)
  }
}

const setup = (
  initial: ChannelConnectorView[] = [connection()],
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>,
) => {
  const views = initial
  const listeners: Listener[] = []
  const received: { channel: string; connector: string; content: string }[] = []
  const reported: Error[] = []
  let create = () => new Listener()
  const registry = new FunnelListenerRegistry({
    channels: {
      listAllConnectors: () => views.map((view) => ({ ...view })),
      createListener: (channel, connector) => {
        const view = views.find((view) => view.channelName === channel && view.name === connector)
        if (!view) return null
        const listener = create()
        listeners.push(listener)
        return { config: view, channelId: view.channelId, listener }
      },
    },
    notify: async (channel, connector, content) => {
      received.push({ channel, connector, content })
    },
    onError: (error) => {
      reported.push(error)
    },
    // Startup deadlines stay pending; recovery backoffs run without wall-clock delays.
    sleep: sleep ?? ((ms) => (ms === 30_000 ? new Promise(() => {}) : Promise.resolve())),
  })
  return {
    views,
    listeners,
    received,
    reported,
    registry,
    useFactory: (factory: () => Listener) => {
      create = factory
    },
  }
}

describe("listener identity", () => {
  test.each(["stop", "stopAll"])(
    "a later %s cancels a restart waiting for teardown",
    async (operation) => {
      const context = setup()
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      class SlowStop extends Listener {
        override async stop(): Promise<void> {
          entered.resolve()
          await release.promise
          await super.stop()
        }
      }
      context.useFactory(() => new SlowStop())
      try {
        await context.registry.startAll()
        const restarting = context.registry.restart("ops", "inbox")
        await entered.promise
        const stopping =
          operation === "stop" ? context.registry.stop("ops", "inbox") : context.registry.stopAll()
        release.resolve()
        const restarted = await restarting
        await stopping
        expect(restarted.ok).toBe(false)
        expect(context.listeners).toHaveLength(1)
        expect(context.registry.list()).toEqual([])
      } finally {
        release.resolve()
        await context.registry.stopAll()
      }
    },
  )

  test("the latest of two overlapping restarts owns the replacement", async () => {
    const context = setup()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    class SlowStop extends Listener {
      override async stop(): Promise<void> {
        entered.resolve()
        await release.promise
        await super.stop()
      }
    }
    context.useFactory(() => new SlowStop())
    try {
      await context.registry.startAll()
      const first = context.registry.restart("ops", "inbox")
      await entered.promise
      const second = context.registry.restart("ops", "inbox")
      release.resolve()
      expect((await first).ok).toBe(false)
      expect((await second).ok).toBe(true)
      expect(context.listeners).toHaveLength(2)
      expect(context.registry.list()).toHaveLength(1)
    } finally {
      release.resolve()
      await context.registry.stopAll()
    }
  })

  test("an explicit restart after a completed stopAll remains available", async () => {
    const context = setup()
    try {
      await context.registry.startAll()
      await context.registry.stopAll()
      expect((await context.registry.restart("ops", "inbox")).ok).toBe(true)
      expect(context.listeners).toHaveLength(2)
    } finally {
      await context.registry.stopAll()
    }
  })

  test("factory failures reach the host and can be retried after the factory is corrected", async () => {
    const { registry, listeners, reported, useFactory } = setup()
    useFactory(() => {
      throw new Error("factory unavailable")
    })
    try {
      const result = await registry.start("ops", "inbox")
      expect(result).toMatchObject({ ok: false, retriable: true, reason: "factory unavailable" })
      expect(reported.map((error) => error.message)).toEqual(["factory unavailable"])
      useFactory(() => new Listener())
      await registry.runHealthCheckForTest()
      expect(listeners).toHaveLength(1)
      expect(registry.isRunning("ops", "inbox")).toBe(true)
    } finally {
      await registry.stopAll()
    }
  })

  test.each(["stop", "stopAll"])(
    "a synchronous abort callback requesting %s cannot stop the same source twice",
    async (operation) => {
      const { registry, listeners, useFactory } = setup()
      const reentrant: Promise<unknown>[] = []
      class OnAbort extends Listener {
        override async start(notify: NotifyFn, signal?: AbortSignal): Promise<void> {
          await super.start(notify)
          signal?.addEventListener(
            "abort",
            () => {
              reentrant.push(
                operation === "stop" ? registry.stop("ops", "inbox") : registry.stopAll(),
              )
            },
            { once: true },
          )
        }
      }
      useFactory(() => new OnAbort())
      try {
        await registry.startAll()
        if (operation === "stop") await registry.stop("ops", "inbox")
        else await registry.stopAll()
        await Promise.all(reentrant)
        expect(listeners[0]!.stopped).toBe(1)
      } finally {
        await registry.stopAll()
      }
    },
  )

  test("a stop request blocks input before the asynchronous source teardown starts", async () => {
    const { registry, listeners, received } = setup()
    try {
      await registry.startAll()
      const stopped = registry.stop("ops", "inbox")
      await expect(listeners[0]!.send("late")).rejects.toThrow("listener stopped")
      await stopped
      expect(received).toEqual([])
    } finally {
      await registry.stopAll()
    }
  })

  test("a successful startup cancels its timeout signal", async () => {
    const deadlines: AbortSignal[] = []
    const { registry } = setup(undefined, (_ms, signal) => {
      deadlines.push(signal!)
      return new Promise(() => {})
    })
    try {
      await registry.startAll()
      expect(deadlines).toHaveLength(1)
      expect(deadlines[0]!.aborted).toBe(true)
    } finally {
      await registry.stopAll()
    }
  })

  test.each(["stop", "stopAll"])("%s cancels the recovery sleep signal", async (operation) => {
    const sleeping = Promise.withResolvers<AbortSignal>()
    const { registry, listeners } = setup(undefined, (ms, signal) => {
      if (ms === 30_000) return new Promise(() => {})
      sleeping.resolve(signal!)
      return new Promise((resolve) =>
        signal!.addEventListener("abort", () => resolve(), { once: true }),
      )
    })
    try {
      await registry.startAll()
      listeners[0]!.alive = false
      const recovery = registry.runHealthCheckForTest()
      const signal = await sleeping.promise
      if (operation === "stop") await registry.stop("ops", "inbox")
      else await registry.stopAll()
      expect(signal.aborted).toBe(true)
      await recovery
      expect(listeners).toHaveLength(1)
    } finally {
      await registry.stopAll()
    }
  })

  test("stable identity keys are lossless when ids also contain separators", async () => {
    const { registry } = setup([
      connection("one", "source", "b", "a/c"),
      connection("two", "source", "c/b", "a"),
    ])
    try {
      await registry.startAll()
      expect(registry.list()).toHaveLength(2)
    } finally {
      await registry.stopAll()
    }
  })
  test("separator characters in labels do not merge distinct connections", async () => {
    const { registry, listeners } = setup([
      connection("a/b", "c"),
      connection("a", "b/c", "source-2", "channel-2"),
    ])
    try {
      await registry.startAll()
      expect(registry.list()).toHaveLength(2)
      expect(listeners).toHaveLength(2)
    } finally {
      await registry.stopAll()
    }
    expect(listeners.every((listener) => !listener.alive)).toBe(true)
  })

  test("renaming a running channel and connector changes routing without opening a duplicate", async () => {
    const { registry, listeners, views, received } = setup()
    try {
      await registry.startAll()
      views[0]!.channelName = "renamed"
      views[0]!.name = "new-inbox"
      await listeners[0]!.send("after rename")
      expect(received).toEqual([
        { channel: "renamed", connector: "new-inbox", content: "after rename" },
      ])
      expect((await registry.start("renamed", "new-inbox")).ok).toBe(true)
      await registry.runHealthCheckForTest()
      expect(listeners).toHaveLength(1)
      expect(registry.list()[0]).toMatchObject({ channelName: "renamed", name: "new-inbox" })
      await registry.stop("renamed", "new-inbox")
      expect(listeners[0]!.alive).toBe(false)
    } finally {
      await registry.stopAll()
    }
  })

  test("a deliberate stop survives label changes until an explicit start", async () => {
    const { registry, listeners, views } = setup()
    try {
      await registry.startAll()
      await registry.stop("ops", "inbox")
      views[0]!.channelName = "renamed"
      views[0]!.name = "renamed"
      await registry.runHealthCheckForTest()
      expect(listeners).toHaveLength(1)
      expect(registry.list()).toEqual([])
      expect((await registry.start("renamed", "renamed")).ok).toBe(true)
      expect(listeners).toHaveLength(2)
    } finally {
      await registry.stopAll()
    }
  })

  test("renaming an auth failure does not bypass the host-action latch", async () => {
    const { registry, listeners, views, useFactory } = setup()
    class AuthFailure extends Listener {
      override async start(): Promise<void> {
        throw new FunnelAuthFailedError("test", "invalid_auth")
      }
    }
    useFactory(() => new AuthFailure())
    try {
      await registry.startAll()
      views[0]!.name = "renamed"
      await registry.runHealthCheckForTest()
      expect(listeners).toHaveLength(1)
      useFactory(() => new Listener())
      expect((await registry.start("ops", "renamed")).ok).toBe(true)
    } finally {
      await registry.stopAll()
    }
  })

  test("a queued retry uses current labels for the same connection id", async () => {
    const { registry, listeners, views, received, useFactory } = setup()
    class Failure extends Listener {
      override async start(): Promise<void> {
        throw new Error("temporary")
      }
    }
    useFactory(() => new Failure())
    try {
      await registry.startAll()
      views[0]!.channelName = "renamed"
      views[0]!.name = "new-inbox"
      useFactory(() => new Listener())
      await registry.runHealthCheckForTest()
      expect(listeners).toHaveLength(2)
      expect(registry.list()).toHaveLength(1)
      await listeners[1]!.send("recovered")
      expect(received[0]).toMatchObject({ channel: "renamed", connector: "new-inbox" })
    } finally {
      await registry.stopAll()
    }
  })

  test("removed connection ids cannot send into replacements with the same labels", async () => {
    const { registry, listeners, views, received } = setup()
    try {
      await registry.startAll()
      views[0] = connection("ops", "inbox", "replacement")
      await expect(listeners[0]!.send("stale")).rejects.toThrow()
      expect(received).toEqual([])
      await registry.runHealthCheckForTest()
      expect(listeners[0]!.alive).toBe(false)
      expect(listeners).toHaveLength(2)
      await listeners[1]!.send("current")
      expect(received.map((event) => event.content)).toEqual(["current"])
    } finally {
      await registry.stopAll()
    }
    expect(listeners.every((listener) => !listener.alive)).toBe(true)
  })

  test("removing a configuration releases its existing source on reconciliation", async () => {
    const { registry, listeners, views } = setup()
    try {
      await registry.startAll()
      views.length = 0
      await registry.runHealthCheckForTest()
      expect(listeners[0]!.alive).toBe(false)
      expect(registry.list()).toEqual([])
    } finally {
      await registry.stopAll()
    }
  })

  test("startAll closes a removed source before opening its replacement", async () => {
    const { registry, listeners, views, useFactory } = setup()
    try {
      await registry.startAll()
      views[0] = connection("ops", "inbox", "replacement")
      useFactory(() => {
        expect(listeners[0]!.alive).toBe(false)
        return new Listener()
      })
      await registry.startAll()
      expect(listeners).toHaveLength(2)
      expect(registry.list()).toHaveLength(1)
    } finally {
      await registry.stopAll()
    }
  })

  test("stopAll closes the original source after both labels change", async () => {
    const { registry, listeners, views } = setup()
    await registry.startAll()
    views[0]!.channelName = "renamed"
    views[0]!.name = "renamed"
    await registry.stopAll()
    expect(listeners[0]!.alive).toBe(false)
    expect(registry.list()).toEqual([])
  })

  test("renaming during startup keeps one start lock for the same identity", async () => {
    const { registry, listeners, views, useFactory } = setup()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    class Opening extends Listener {
      override async start(notify: NotifyFn): Promise<void> {
        entered.resolve()
        await release.promise
        await super.start(notify)
      }
    }
    useFactory(() => new Opening())
    const opening = registry.start("ops", "inbox")
    await entered.promise
    views[0]!.channelName = "renamed"
    views[0]!.name = "renamed"
    try {
      const duplicate = registry.start("renamed", "renamed")
      release.resolve()
      expect((await duplicate).ok).toBe(false)
      expect((await opening).ok).toBe(true)
      expect(listeners).toHaveLength(1)
      expect(registry.isRunning("renamed", "renamed")).toBe(true)
    } finally {
      release.resolve()
      await registry.stopAll()
    }
  })

  test.each([false, true])(
    "recovery resolves current labels and preserves a stop during backoff (%s)",
    async (stop) => {
      const sleeping = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const { registry, views, listeners } = setup(undefined, (ms) => {
        if (ms === 30_000) return new Promise(() => {})
        sleeping.resolve()
        return release.promise
      })
      try {
        await registry.startAll()
        listeners[0]!.alive = false
        const recovery = registry.runHealthCheckForTest()
        await sleeping.promise
        views[0]!.channelName = "renamed"
        views[0]!.name = "renamed"
        if (stop) await registry.stop("renamed", "renamed")
        release.resolve()
        await recovery
        expect(listeners).toHaveLength(stop ? 1 : 2)
        expect(registry.isRunning("renamed", "renamed")).toBe(!stop)
      } finally {
        release.resolve()
        await registry.stopAll()
      }
    },
  )

  test.each([false, true])(
    "restart follows its original identity while stop is pending (%s)",
    async (replace) => {
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const { registry, views, listeners, useFactory } = setup()
      class Closing extends Listener {
        override async stop(): Promise<void> {
          entered.resolve()
          await release.promise
          await super.stop()
        }
      }
      useFactory(() => new Closing())
      await registry.startAll()
      const restart = registry.restart("ops", "inbox")
      await entered.promise
      views[0] = replace
        ? connection("ops", "inbox", "replacement")
        : connection("renamed", "renamed")
      release.resolve()
      try {
        expect((await restart).ok).toBe(!replace)
        expect(listeners).toHaveLength(replace ? 1 : 2)
      } finally {
        await registry.stopAll()
      }
    },
  )

  test("a rename before the startup microtask still opens the configured identity", async () => {
    const { registry, views, listeners } = setup()
    const starting = registry.start("ops", "inbox")
    views[0]!.channelName = "renamed"
    views[0]!.name = "renamed"
    try {
      expect((await starting).ok).toBe(true)
      expect(listeners).toHaveLength(1)
    } finally {
      await registry.stopAll()
    }
  })
})

test("default startup cancellation does not wait for an unresponsive source's timeout", async () => {
  const entered = Promise.withResolvers<void>()
  const view = connection()
  class Hanging extends Listener {
    override async start(): Promise<void> {
      entered.resolve()
      await new Promise(() => {})
    }
  }
  const listener = new Hanging()
  const registry = new FunnelListenerRegistry({
    channels: {
      listAllConnectors: () => [view],
      createListener: () => ({ config: view, channelId: view.channelId, listener }),
    },
    notify: async () => {},
  })
  const starting = registry.start("ops", "inbox")
  await entered.promise
  await registry.stopAll()
  expect((await starting).ok).toBe(false)
  expect(listener.stopped).toBeGreaterThan(0)
}, 500)

test("Funnel routes a renamed running source to the existing native subscription by stable ids", async () => {
  const listeners: Listener[] = []
  const connector: ConnectorDescriptor = {
    type: "test",
    createAdapter: null,
    toolExposed: false,
    secretTokens: () => [],
    operations: {},
    buildConfig: (input, context) => ({ id: context.id, name: String(input.name), type: "test" }),
    applyUpdate: (config) => config,
    createListener: () => {
      const listener = new Listener()
      listeners.push(listener)
      return listener
    },
  }
  const funnel = new Funnel({
    connectors: [connector],
    channels: [{ name: "ops", connectors: [{ type: "test", name: "inbox" }] }],
  })
  const channel = funnel.channels.get("ops")!
  const connectorId = channel.connectors[0]!.id
  const gateway = funnel.gatewayModule({ token: "" })
  const events = gateway.events({ channel: channel.id })
  try {
    await gateway.start()
    funnel.channels.rename("ops", "team")
    funnel.channels.renameConnector("team", "inbox", "events")
    await listeners[0]!.send("renamed input")
    expect((await events.next()).value.meta).toMatchObject({
      channel: "team",
      connector: "events",
      channelId: channel.id,
      connectorId,
    })
    expect((await gateway.getRegistry().restart("team", "events")).ok).toBe(true)
    expect(listeners[0]!.alive).toBe(false)
    expect(listeners).toHaveLength(2)
  } finally {
    await gateway.stop()
  }
  expect(listeners.every((listener) => !listener.alive)).toBe(true)
})
