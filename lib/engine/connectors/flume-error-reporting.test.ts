import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("failed delivery reporters cannot stop later events or leak promise rejections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "funnel-delivery-errors-"))
  const script = join(dir, "delivery-errors.ts")
  await Bun.write(
    script,
    `
    import { FlumeSource } from ${JSON.stringify(import.meta.resolve("@interactive-inc/flume"))}
    import { FunnelFlumeSourceListener } from ${JSON.stringify(import.meta.resolve("@/engine/connectors/flume-source-listener"))}
    import { MemoryConnectorDiagnosticLog } from ${JSON.stringify(import.meta.resolve("@/engine/diagnostic-log/memory-diagnostic-log"))}
    import { MemoryFunnelLogger } from ${JSON.stringify(import.meta.resolve("@/engine/logger/memory-logger"))}
    const result = { unhandled: 0, cases: [] }
    process.on("unhandledRejection", () => { result.unhandled++ })
    class Source extends FlumeSource {
      name = "test"
      context = null
      fail = false
      async connect(context) { this.context = context; return this.fail ? new Error("connect failed") : null }
      async disconnect() { this.context = null; throw new Error("disconnect failed") }
      emit() { this.context.onEvent({ source: "test", type: "message", data: {}, meta: {}, receivedAt: 0 }) }
    }
    for (const mode of ["throwing logger", "rejecting logger", "throwing diagnostic"]) {
      const state = { mode, calls: 0, logged: 0, recorded: 0, startFailure: false }
      class Logger extends MemoryFunnelLogger {
        error() {
          state.logged++
          if (mode === "throwing logger") throw new Error("logger failed")
          if (mode === "rejecting logger") return Promise.reject(new Error("logger failed"))
        }
      }
      class Log extends MemoryConnectorDiagnosticLog {
        recordConnection(entry) {
          if (entry.status === "error") {
            state.recorded++
            if (mode === "throwing diagnostic") throw new Error("diagnostic failed")
          }
          super.recordConnection(entry)
        }
      }
      class Listener extends FunnelFlumeSourceListener {
        source = new Source()
        constructor() { super({ type: "test", channelId: "ops", connectorId: "source", logger: new Logger(), diagnosticLog: new Log() }) }
        async start() {
          await this.runStart({ sources: [this.source], onEvent: () => {
            state.calls++
            if (state.calls === 1) throw new Error("delivery failed")
          } })
        }
      }
      const listener = new Listener()
      await listener.start()
      listener.source.emit()
      listener.source.emit()
      await Bun.sleep(20)
      await listener.stop()
      const failed = new Listener()
      failed.source.fail = true
      try { await failed.start() }
      catch (error) { state.startFailure = error.message.includes("connect failed") }
      result.cases.push(state)
    }
    await Bun.sleep(10)
    console.log(JSON.stringify(result))
  `,
  )
  const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" })
  try {
    const output = await new Response(child.stdout).text()
    expect(await new Response(child.stderr).text()).toBe("")
    expect(await child.exited).toBe(0)
    expect(JSON.parse(output)).toEqual({
      unhandled: 0,
      cases: ["throwing logger", "rejecting logger", "throwing diagnostic"].map((mode) => ({
        mode,
        calls: 2,
        // A diagnostic write failure is logged alongside each original error.
        logged: mode === "throwing diagnostic" ? 6 : 3,
        recorded: 3,
        startFailure: true,
      })),
    })
  } finally {
    child.kill()
    await child.exited
    rmSync(dir, { recursive: true, force: true })
  }
})
