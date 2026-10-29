import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"

test("same-name detached startups remain ambiguous and can be stopped together", async () => {
  let configured = true
  const first = { id: "first", name: "source", type: "test" }
  const second = { id: "second", name: "source", type: "test" }
  const configs = [first]
  const entered = [Promise.withResolvers<AbortSignal>(), Promise.withResolvers<AbortSignal>()]
  const release = Promise.withResolvers<void>()
  class Listener extends FunnelConnectorListener {
    constructor(private readonly index: number) {
      super()
    }
    async start(_notify: NotifyFn, signal?: AbortSignal) {
      entered[this.index]!.resolve(signal!)
      await release.promise
    }
    async stop() {}
  }
  const registry = new FunnelListenerRegistry({
    channels: {
      listAllConnectors: () =>
        configured
          ? configs.map((config) => ({ ...config, channelId: "ops", channelName: "ops" }))
          : [],
      createListener: (_channel, name) => {
        const config = configs.find((item) => item.name === name)!
        return { config, channelId: "ops", listener: new Listener(config === first ? 0 : 1) }
      },
    },
    notify: async () => {},
  })
  const starts = [registry.start("ops", "source")]
  try {
    const firstSignal = await entered[0]!.promise
    first.name = "renamed"
    configs.push(second)
    starts.push(registry.start("ops", "source"))
    const secondSignal = await entered[1]!.promise
    configured = false
    await expect(registry.stop("ops", "source")).rejects.toThrow("listener name is ambiguous")
    expect(firstSignal.aborted).toBe(false)
    expect(secondSignal.aborted).toBe(false)
    await registry.stopAll()
    expect(firstSignal.aborted).toBe(true)
    expect(secondSignal.aborted).toBe(true)
    expect(await Promise.all(starts)).toEqual([
      { ok: false, reason: "start cancelled" },
      { ok: false, reason: "start cancelled" },
    ])
  } finally {
    release.resolve()
    await registry.close()
    await Promise.all(starts)
  }
})

for (const phase of ["queued", "opening"] as const) {
  test(`stop finds a ${phase} startup after its configuration is removed`, async () => {
    let configured = true
    const entered = Promise.withResolvers<AbortSignal>()
    const release = Promise.withResolvers<void>()
    class Listener extends FunnelConnectorListener {
      async start(_notify: NotifyFn, signal?: AbortSignal) {
        entered.resolve(signal!)
        await release.promise
      }
      async stop() {}
    }
    const config = { id: "source", name: "source", type: "test" }
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () =>
          configured ? [{ ...config, channelId: "ops", channelName: "ops" }] : [],
        createListener: () => ({ config, channelId: "ops", listener: new Listener() }),
      },
      notify: async () => {},
    })
    const starting = registry.start("ops", "source")
    try {
      const signal = phase === "opening" ? await entered.promise : undefined
      configured = false
      expect(await registry.stop("ops", "source")).toEqual({ ok: true, reason: "not running" })
      if (signal) expect(signal.aborted).toBe(true)
      expect(await starting).toMatchObject({ ok: false, reason: "start cancelled" })
      expect(registry.list()).toEqual([])
    } finally {
      release.resolve()
      await registry.close()
      await starting
    }
  })
}

test("running and starting views of the same connection do not create false ambiguity", async () => {
  let configured = true
  let stopping: Promise<unknown> | undefined
  let stops = 0
  const config = { id: "source", name: "source", type: "test" }
  class Listener extends FunnelConnectorListener {
    async start() {}
    async stop() {
      stops++
    }
  }
  class Logger extends MemoryFunnelLogger {
    override info(message: string) {
      if (message === "test listener started") {
        configured = false
        stopping = registry.stop("ops", "source")
      }
    }
  }
  const registry = new FunnelListenerRegistry({
    channels: {
      listAllConnectors: () =>
        configured ? [{ ...config, channelId: "ops", channelName: "ops" }] : [],
      createListener: () => ({ config, channelId: "ops", listener: new Listener() }),
    },
    logger: new Logger(),
    notify: async () => {},
  })
  try {
    await registry.start("ops", "source")
    await expect(stopping).resolves.toMatchObject({ ok: true })
    expect(stops).toBe(1)
  } finally {
    await registry.close()
  }
})
