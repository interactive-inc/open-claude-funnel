import { expect, test } from "bun:test"

test("Flume diagnostic and logger promise rejections cannot escape delivery or shutdown", async () => {
  const source = `
import { FlumeSource } from ${JSON.stringify(import.meta.resolve("@interactive-inc/flume"))}
import { FunnelFlumeSourceListener } from ${JSON.stringify(import.meta.resolve("@/engine/connectors/flume-source-listener"))}
import { MemoryConnectorDiagnosticLog } from ${JSON.stringify(import.meta.resolve("@/engine/diagnostic-log/memory-diagnostic-log"))}
import { NoopFunnelLogger } from ${JSON.stringify(import.meta.resolve("@/engine/logger/noop-logger"))}
const result = { calls: 0, stopped: false, unhandled: [] }
process.on("unhandledRejection", error => result.unhandled.push(String(error)))
class Source extends FlumeSource {
  name = "slack"
  context = null
  async connect(context) { this.context = context; return null }
  async disconnect() { this.context = null }
  emit() { this.context.onEvent({ source: "slack", type: "message", data: {}, meta: {}, receivedAt: 0 }) }
}
class Diagnostics extends MemoryConnectorDiagnosticLog {
  recordRaw() { return Promise.reject(new Error("raw rejected")) }
  recordProcessed() { return Promise.reject(new Error("processed rejected")) }
  recordConnection() { return Promise.reject(new Error("connection rejected")) }
}
class Logger extends NoopFunnelLogger {
  info() { return Promise.reject(new Error("info rejected")) }
  error() { return Promise.reject(new Error("error rejected")) }
}
class Listener extends FunnelFlumeSourceListener {
  source = new Source()
  constructor() { super({ type: "slack", channelId: "channel", connectorId: "source", diagnosticLog: new Diagnostics(), logger: new Logger() }) }
  async start() {
    this.diagnostics.recordConnection("started", "")
    await this.runStart({ sources: [this.source], onEvent: async () => {
      this.diagnostics.recordRaw("event", "{}")
      this.logger.info("received")
      if (++result.calls === 1) throw new Error("delivery failed")
      this.diagnostics.recordProcessed("event", "emitted", "{}")
    } })
  }
  async settle() { await this.running.drain(); await Bun.sleep(0) }
  onStop() { result.stopped = true }
}
const listener = new Listener()
await listener.start()
listener.source.emit()
listener.source.emit()
await listener.settle()
await listener.stop()
await Bun.sleep(20)
console.log(JSON.stringify(result))
`
  const child = Bun.spawn([process.execPath, "-e", source], { stdout: "pipe", stderr: "pipe" })
  const [output, errors, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ errors, exit }).toEqual({ errors: "", exit: 0 })
  expect(JSON.parse(output)).toEqual({ calls: 2, stopped: true, unhandled: [] })
})
