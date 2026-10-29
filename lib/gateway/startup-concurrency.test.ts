import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"

const setup = (kind: "module" | "server") => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const state = { starts: 0, stops: 0, alive: 0 }
  class Source extends FunnelConnectorListener {
    private alive = false
    async start(_notify: NotifyFn, signal?: AbortSignal): Promise<void> {
      state.starts++
      entered.resolve()
      await release.promise
      if (signal?.aborted) return
      this.alive = true
      state.alive++
    }
    async stop(): Promise<void> {
      state.stops++
      if (this.alive) state.alive--
      this.alive = false
    }
    override isAlive(): boolean {
      return this.alive
    }
  }
  const descriptor: ConnectorDescriptor = {
    type: "test",
    toolExposed: false,
    secretTokens: () => [],
    operations: {},
    createAdapter: null,
    buildConfig: (input, context) => ({ id: context.id, name: String(input.name), type: "test" }),
    applyUpdate: (config) => config,
    createListener: () => new Source(),
  }
  const clock = new MemoryFunnelClock()
  const funnel = new Funnel({
    clock,
    connectors: [descriptor],
    channels: [{ name: "ops", connectors: [{ type: "test", name: "source" }] }],
  })
  const gateway =
    kind === "module"
      ? funnel.gatewayModule({ token: "" })
      : funnel.gatewayServer({ port: 0, token: "" })
  const module = "getModule" in gateway ? gateway.getModule() : gateway
  return { gateway, module, entered, release, state, clock }
}

for (const kind of ["module", "server"] as const) {
  test(`${kind} concurrent starts await the same boot without resetting its uptime`, async () => {
    const context = setup(kind)
    const first = context.gateway.start()
    await context.entered.promise
    context.clock.advance(5000)
    const second = context.gateway.start()
    let secondSettled = false
    void second.then(
      () => {
        secondSettled = true
      },
      () => {
        secondSettled = true
      },
    )
    try {
      await Bun.sleep(0)
      expect(secondSettled).toBe(false)
      expect(context.state.starts).toBe(1)
      context.release.resolve()
      await Promise.all([first, second])
      context.clock.advance(250)
      expect(await (await context.module.app.request("/status")).json()).toMatchObject({
        uptimeMs: 5250,
      })
    } finally {
      context.release.resolve()
      await Promise.allSettled([first, second])
      await context.gateway.stop()
    }
  })

  test(`${kind} startup cannot report success after shutdown cancels its listeners`, async () => {
    const context = setup(kind)
    const startup = context.gateway.start().then(
      () => "started",
      (error: unknown) => error,
    )
    await context.entered.promise
    try {
      await context.gateway.stop()
      context.release.resolve()
      expect(await startup).toMatchObject({ message: "gateway stopped during startup" })
      await Bun.sleep(0)
      expect(context.state.alive).toBe(0)
      await expect(context.gateway.start()).rejects.toThrow("single-use")
    } finally {
      context.release.resolve()
      await context.gateway.stop()
    }
  })

  test(`${kind} shares fatal boot failures, cleans sources and allows an explicit retry`, async () => {
    const context = setup(kind)
    const registry = context.gateway.getRegistry()
    const startAll = registry.startAll.bind(registry)
    const failure = new Error("boot failed after opening sources")
    let fail = true
    registry.startAll = async () => {
      await startAll()
      if (fail) throw failure
    }
    context.release.resolve()
    try {
      const results = await Promise.allSettled([context.gateway.start(), context.gateway.start()])
      for (const result of results)
        expect(result).toMatchObject({ status: "rejected", reason: failure })
      expect(context.state.alive).toBe(0)
      fail = false
      context.clock.advance(5000)
      await context.gateway.start()
      expect(context.state.alive).toBe(1)
      expect(context.state.starts).toBe(2)
      context.clock.advance(250)
      expect(await (await context.module.app.request("/status")).json()).toMatchObject({
        uptimeMs: 250,
      })
    } finally {
      await context.gateway.stop()
    }
  })
}

test("failed startup preflight does not close an already running module", async () => {
  const context = setup("module")
  context.release.resolve()
  try {
    await context.gateway.start()
    context.clock.set(new Date(NaN))
    await expect(context.gateway.start()).rejects.toThrow("time must be a valid timestamp")
    expect(context.state.alive).toBe(1)
    expect(context.state.starts).toBe(1)
    context.clock.set(new Date(1000))
    expect(await (await context.module.app.request("/status")).json()).toMatchObject({
      uptimeMs: 1000,
    })
  } finally {
    await context.gateway.stop()
  }
})
