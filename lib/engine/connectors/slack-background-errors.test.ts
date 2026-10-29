import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

async function run(source: string): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), "funnel-slack-background-"))
  const path = join(dir, "probe.ts")
  await Bun.write(path, source)
  const child = Bun.spawn([process.execPath, path], { stdout: "pipe", stderr: "pipe" })
  try {
    const output = await new Response(child.stdout).text()
    expect(await new Response(child.stderr).text()).toBe("")
    expect(await child.exited).toBe(0)
    return JSON.parse(output)
  } finally {
    child.kill()
    await child.exited
    rmSync(dir, { recursive: true, force: true })
  }
}

test("Flume log forwarding preserves async logger results so the owner can observe rejections", async () => {
  const output = await run(`
    import { flumeLogHandler } from ${JSON.stringify(import.meta.resolve("@/engine/connectors/flume-deps"))}
    import { MemoryFunnelLogger } from ${JSON.stringify(import.meta.resolve("@/engine/logger/memory-logger"))}
    const state = { unhandled: 0, observed: [] }
    process.on("unhandledRejection", () => { state.unhandled++ })
    class Logger extends MemoryFunnelLogger {
      async info() { throw new Error("info failed") }
      async warn() { throw new Error("warn failed") }
      async error() { throw new Error("error failed") }
    }
    const handler = flumeLogHandler(new Logger())
    for (const level of ["info", "warn", "error"]) {
      await Promise.resolve(handler({ level, source: "slack", action: "test", message: "event", timestamp: 0 }))
        .catch((error) => { state.observed.push(error.message) })
    }
    await Bun.sleep(10)
    console.log(JSON.stringify(state))
  `)
  expect(output).toEqual({ unhandled: 0, observed: ["info failed", "warn failed", "error failed"] })
})

test("reaction failure reporting cannot reject in the background or interrupt later source delivery", async () => {
  const output = await run(`
    import { FunnelFlumeSlackListener } from ${JSON.stringify(import.meta.resolve("@/engine/connectors/slack-flume-listener"))}
    import { MemoryFunnelHttpClient } from ${JSON.stringify(import.meta.resolve("@/engine/http/memory-http-client"))}
    import { MemoryFunnelLogger } from ${JSON.stringify(import.meta.resolve("@/engine/logger/memory-logger"))}
    import { MemoryConnectorDiagnosticLog } from ${JSON.stringify(import.meta.resolve("@/engine/diagnostic-log/memory-diagnostic-log"))}
    const result = { unhandled: 0, cases: [] }
    process.on("unhandledRejection", () => { result.unhandled++ })
    class Socket {
      static instances = []
      static OPEN = 1
      static CLOSED = 3
      readyState = 1
      handlers = new Map()
      constructor() { Socket.instances.push(this); setTimeout(() => this.emit({ type: "hello" }), 0) }
      addEventListener(type, handler) { const set = this.handlers.get(type) ?? new Set(); set.add(handler); this.handlers.set(type, set) }
      removeEventListener(type, handler) { this.handlers.get(type)?.delete(handler) }
      send() {}
      close() { this.readyState = 3; for (const handler of this.handlers.get("close") ?? []) handler({ code: 1000, reason: "" }) }
      emit(frame) { for (const handler of this.handlers.get("message") ?? []) handler({ data: JSON.stringify(frame) }) }
    }
    for (const mode of ["diagnostic", "async diagnostic", "logger", "async logger"]) {
      const state = { mode, delivered: 0, reactions: 0, recorded: 0, warned: 0 }
      class Logger extends MemoryFunnelLogger {
        warn(message, meta) {
          if (message !== "slack reaction failed") return super.warn(message, meta)
          state.warned++
          if (mode === "logger") throw new Error("logger failed")
          if (mode === "async logger") return Promise.reject(new Error("async logger failed"))
        }
      }
      class Log extends MemoryConnectorDiagnosticLog {
        recordProcessed(record) {
          if (record.outcome === "emitted:reaction-failed") {
            state.recorded++
            if (mode === "diagnostic") throw new Error("diagnostic failed")
            if (mode === "async diagnostic") return Promise.reject(new Error("async diagnostic failed"))
          }
          super.recordProcessed(record)
        }
      }
      const http = new MemoryFunnelHttpClient().on((request) => {
        if (request.url.endsWith("auth.test")) return { body: JSON.stringify({ ok: true, user_id: "BOT", bot_id: "BOT_ID" }) }
        state.reactions++
        return { body: JSON.stringify({ ok: false, error: "reaction unavailable" }) }
      })
      const listener = new FunnelFlumeSlackListener({
        config: { id: "source", type: "slack", name: "events", appToken: "xapp-example", botToken: "xoxb-example", minify: true },
        http, logger: new Logger(), diagnosticLog: new Log(),
        flumeDeps: {
          WebSocket: Socket,
          fetch: async () => Response.json({ ok: true, url: "wss://socket.example" }),
        },
      })
      await listener.start(async () => { state.delivered++ })
      try {
        const socket = Socket.instances.at(-1)
        const emit = (ts, text) => socket.emit({
          type: "events_api", envelope_id: ts, payload: { event: { type: "message", user: "USER", channel: "C1", ts, text } },
        })
        emit("1.0", "hello <@BOT>")
        await Bun.sleep(10)
        emit("2.0", "later input")
        await Bun.sleep(10)
      } finally { await listener.stop() }
      result.cases.push(state)
    }
    await Bun.sleep(10)
    console.log(JSON.stringify(result))
  `)
  expect(output).toEqual({
    unhandled: 0,
    cases: ["diagnostic", "async diagnostic", "logger", "async logger"].map((mode) => ({
      mode,
      delivered: 2,
      reactions: 1,
      recorded: 1,
      warned: 1,
    })),
  })
})
