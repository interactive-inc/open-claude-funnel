import { expect, test } from "bun:test"

test("async broadcast failures reach the logger and do not escape or stop later delivery", async () => {
  const source = `
import { FlumeSource } from ${JSON.stringify(import.meta.resolve("@interactive-inc/flume"))}
import { FunnelChannelSupervisor } from ${JSON.stringify(import.meta.resolve("@/engine/channel/channel-supervisor"))}
import { MemoryFunnelLogger } from ${JSON.stringify(import.meta.resolve("@/engine/logger/memory-logger"))}
import { MemoryFunnelClock } from ${JSON.stringify(import.meta.resolve("@/engine/time/memory-clock"))}
const unhandled = []
process.on("unhandledRejection", error => unhandled.push(String(error)))
class Source extends FlumeSource {
  name = "discord"
  async connect() { this.setStatus("connected"); return null }
  disconnect() {}
  push() { this.emit({ source: "discord", type: "input", data: {}, meta: {}, receivedAt: 0 }) }
}
const results = []
for (const kind of ["promise", "hidden-then", "thenable", "stop"]) {
  const logger = new MemoryFunnelLogger()
  const source = new Source()
  let calls = 0
  const delivered = Promise.withResolvers()
  const supervisor = new FunnelChannelSupervisor({
    logger, clock: new MemoryFunnelClock(),
    broadcaster: { broadcast() {
      if (kind === "stop") {
        calls++
        return supervisor.stop().then(() => delivered.resolve())
      }
      if (++calls > 1) { delivered.resolve(); return }
      const error = new Error("sink unavailable")
      if (kind === "thenable") return { then(resolve, reject) { reject(error) } }
      const result = Promise.reject(error)
      if (kind === "hidden-then") Object.defineProperty(result, "then", { value: undefined })
      return result
    } },
  })
  supervisor.register({ id: "source", build: () => ({ sources: [source] }) })
  const timer = setTimeout(() => delivered.reject(new Error("delivery timed out")), 1000)
  try {
    await supervisor.start()
    source.push()
    source.push()
    await delivered.promise
    await Bun.sleep(10)
    results.push({ kind, calls, errors: logger.entries.filter(entry => entry.level === "error").map(entry => entry.meta?.error) })
  } finally {
    clearTimeout(timer)
    await supervisor.stop()
  }
}
await Bun.sleep(10)
console.log(JSON.stringify({ results, unhandled }))
`
  const child = Bun.spawn([process.execPath, "-e", source], { stdout: "pipe", stderr: "pipe" })
  const [output, errors, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ errors, exit }).toEqual({ errors: "", exit: 0 })
  expect(JSON.parse(output)).toEqual({
    results: [
      ...["promise", "hidden-then", "thenable"].map((kind) => ({
        kind,
        calls: 2,
        errors: ["sink unavailable"],
      })),
      { kind: "stop", calls: 1, errors: [] },
    ],
    unhandled: [],
  })
})
