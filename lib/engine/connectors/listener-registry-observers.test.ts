import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { FunnelAuthFailedError } from "@/engine/error/funnel-error"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

class Source extends FunnelConnectorListener {
  alive = false
  starts = 0
  stops = 0
  startFailure: Error | undefined
  stopFailure: Error | undefined
  async start(): Promise<void> {
    this.starts++
    if (this.startFailure) throw this.startFailure
    this.alive = true
  }
  async stop(): Promise<void> {
    this.stops++
    this.alive = false
    if (this.stopFailure) throw this.stopFailure
  }
  override isAlive(): boolean {
    return this.alive
  }
}

class Logger extends MemoryFunnelLogger {
  failing = true
  override info(): void {
    if (this.failing) throw new Error("info failed")
  }
  override warn(): void {
    if (this.failing) throw new Error("warn failed")
  }
  override error(): void {
    if (this.failing) throw new Error("error logger failed")
  }
}

const setup = (onError?: OnFunnelError) => {
  const source = new Source()
  const logger = new Logger()
  const config = { id: "source", name: "events", type: "test" }
  const registry = new FunnelListenerRegistry({
    logger,
    onError,
    notify: async () => {},
    sleep: async () => {},
    channels: {
      listAllConnectors: () => [{ ...config, channelId: "channel", channelName: "ops" }],
      createListener: () => ({ config, channelId: "channel", listener: source }),
    },
  })
  return { registry, source, logger }
}

test("logger failures cannot turn a successful start into a stopped registered listener", async () => {
  const reported: Error[] = []
  const { registry, source } = setup((error) => {
    reported.push(error)
  })
  try {
    expect(await registry.start("ops", "events")).toMatchObject({ ok: true })
    expect(source.alive).toBe(true)
    expect(source.stops).toBe(0)
    expect(registry.list()[0]).toMatchObject({ alive: true })
    expect(reported.map((error) => error.message)).toEqual(["info failed"])
  } finally {
    await registry.stopAll()
  }
})

test("a failed stop log cannot change a successful shutdown result", async () => {
  const { registry, source, logger } = setup()
  logger.failing = false
  await registry.start("ops", "events")
  logger.failing = true
  try {
    expect(await registry.stop("ops", "events")).toMatchObject({ ok: true })
    expect(source.stops).toBe(1)
    expect(source.alive).toBe(false)
  } finally {
    await registry.stopAll()
  }
})

test("logging and reporter failures preserve non-retriable source authentication failures", async () => {
  const reported: Error[] = []
  const { registry, source } = setup((error) => {
    reported.push(error)
    throw new Error("reporter failed")
  })
  source.startFailure = new FunnelAuthFailedError("events", "credentials missing")
  try {
    expect(await registry.start("ops", "events")).toMatchObject({
      ok: false,
      retriable: false,
      reason: source.startFailure.message,
    })
    expect(reported).toContain(source.startFailure)
    expect(source.alive).toBe(false)
  } finally {
    await registry.stopAll()
  }
})

test("source shutdown failure stays a structured result even if both reporters throw", async () => {
  const { registry, source, logger } = setup(() => {
    throw new Error("reporter failed")
  })
  logger.failing = false
  await registry.start("ops", "events")
  logger.failing = true
  source.stopFailure = new Error("transport stop failed")
  try {
    expect(await registry.stop("ops", "events")).toEqual({
      ok: false,
      reason: "transport stop failed",
    })
    expect(registry.list()).toEqual([])
    source.stopFailure = undefined
    expect(await registry.start("ops", "events")).toMatchObject({ ok: true })
  } finally {
    await registry.stopAll()
  }
})

test("health recovery continues through failed warning and information logs", async () => {
  const { registry, source, logger } = setup()
  logger.failing = false
  await registry.startAll()
  source.alive = false
  logger.failing = true
  try {
    await registry.runHealthCheckForTest()
    expect(source.starts).toBe(2)
    expect(source.alive).toBe(true)
    expect(registry.list()[0]).toMatchObject({ alive: true })
  } finally {
    await registry.stopAll()
  }
})

test("async registry observers and late cleanup failures are observed without unhandled rejections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "funnel-registry-observers-"))
  const script = join(dir, "registry-observers.ts")
  await Bun.write(
    script,
    `
    import { FunnelListenerRegistry } from ${JSON.stringify(import.meta.resolve("@/engine/connectors/listener-registry"))}
    import { FunnelConnectorListener } from ${JSON.stringify(import.meta.resolve("@/engine/connectors/connector-listener"))}
    import { MemoryFunnelLogger } from ${JSON.stringify(import.meta.resolve("@/engine/logger/memory-logger"))}
    import { FunnelAuthFailedError } from ${JSON.stringify(import.meta.resolve("@/engine/error/funnel-error"))}
    const state = { unhandled: 0, recovered: false, stopped: false, originalReported: false, classified: false, lateReported: false }
    process.on("unhandledRejection", () => { state.unhandled++ })
    class Logger extends MemoryFunnelLogger {
      async info() { throw new Error("async info failed") }
      async warn() { throw new Error("async warn failed") }
      async error() { throw new Error("async error logger failed") }
    }
    class Source extends FunnelConnectorListener {
      alive = false
      starts = 0
      failure = undefined
      async start() { this.starts++; if (this.failure) throw this.failure; this.alive = true }
      async stop() { this.alive = false }
      isAlive() { return this.alive }
    }
    const source = new Source()
    const config = { id: "source", type: "test", name: "events" }
    const channelsFor = (listener) => ({
      listAllConnectors: () => [{ ...config, channelId: "channel", channelName: "ops" }],
      createListener: () => ({ config, channelId: "channel", listener }),
    })
    const onError = async (error, context) => {
      if (error === source.failure) state.originalReported = true
      if (context?.component === "listener-registry.late-stop") state.lateReported = true
      throw new Error("async reporter failed")
    }
    const registry = new FunnelListenerRegistry({ channels: channelsFor(source), logger: new Logger(), onError, notify: async () => {}, sleep: async () => {} })
    try {
      await registry.startAll()
      source.alive = false
      await registry.runHealthCheckForTest()
      state.recovered = source.starts === 2 && source.alive
      state.stopped = (await registry.stop("ops", "events")).ok
      source.failure = new FunnelAuthFailedError("events", "credentials missing")
      const result = await registry.start("ops", "events")
      state.classified = !result.ok && result.retriable === false && result.reason === source.failure.message
    } finally { await registry.stopAll() }
    const opening = Promise.withResolvers()
    class LateSource extends Source {
      async start() { await opening.promise }
      async stop() { throw new Error("late stop failed") }
    }
    const late = new FunnelListenerRegistry({ channels: channelsFor(new LateSource()), logger: new Logger(), onError, notify: async () => {}, startTimeoutMs: 1 })
    await late.start("ops", "events")
    opening.resolve()
    await Bun.sleep(20)
    await late.stopAll()
    console.log(JSON.stringify(state))
  `,
  )
  const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" })
  try {
    const output = await new Response(child.stdout).text()
    expect(await new Response(child.stderr).text()).toBe("")
    expect(await child.exited).toBe(0)
    expect(JSON.parse(output)).toEqual({
      unhandled: 0,
      recovered: true,
      stopped: true,
      originalReported: true,
      classified: true,
      lateReported: true,
    })
  } finally {
    child.kill()
    await child.exited
    rmSync(dir, { recursive: true, force: true })
  }
})
