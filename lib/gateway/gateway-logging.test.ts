import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("a throwing startup logger does not leave a failed facade over a bound server", async () => {
  const reported: string[] = []
  class Logger extends MemoryFunnelLogger {
    override info(): void {
      throw new Error("logger unavailable")
    }
  }
  const gateway = new Funnel({
    logger: new Logger(),
    onError(error) {
      reported.push(error.message)
    },
  }).gatewayServer({ port: 0, token: "" })
  try {
    await gateway.start()
    expect((await fetch(`http://127.0.0.1:${gateway.port}/health`)).status).toBe(200)
    expect(reported).toEqual(Array.from({ length: 3 }, () => "logger unavailable"))
  } finally {
    await gateway.stop()
  }
})

test("async startup logging and error reporter failures do not leak rejections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "funnel-gateway-log-"))
  const script = join(dir, "gateway-log.ts")
  await Bun.write(
    script,
    `
    import { Funnel } from ${JSON.stringify(import.meta.resolve("@/funnel"))}
    import { MemoryFunnelLogger } from ${JSON.stringify(import.meta.resolve("@/engine/logger/memory-logger"))}
    const state = { unhandled: 0, logged: 0, reported: 0, healthy: false }
    process.on("unhandledRejection", () => { state.unhandled++ })
    class Logger extends MemoryFunnelLogger {
      async info() { state.logged++; throw new Error("logger unavailable") }
    }
    const gateway = new Funnel({
      logger: new Logger(),
      onError: async () => { state.reported++; throw new Error("reporter unavailable") },
    }).gatewayServer({ port: 0, token: "" })
    try {
      await gateway.start()
      state.healthy = (await fetch("http://127.0.0.1:" + gateway.port + "/health")).status === 200
      await Bun.sleep(10)
    } finally { await gateway.stop() }
    console.log(JSON.stringify(state))
  `,
  )
  const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" })
  try {
    const output = await new Response(child.stdout).text()
    expect(await new Response(child.stderr).text()).toBe("")
    expect(await child.exited).toBe(0)
    expect(JSON.parse(output)).toEqual({ unhandled: 0, logged: 3, reported: 3, healthy: true })
  } finally {
    child.kill()
    await child.exited
    rmSync(dir, { recursive: true, force: true })
  }
})
