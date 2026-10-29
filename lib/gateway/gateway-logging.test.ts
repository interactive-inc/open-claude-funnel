import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const thrownValues = [
  { name: "null-prototype value", create: () => Object.create(null) },
  {
    name: "revoked proxy",
    create: () => {
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      return proxy
    },
  },
  { name: "Error", create: () => new Error("original logger failure") },
]

for (const fixture of thrownValues) {
  for (const mode of ["throw", "reject"] as const) {
    test(`logger ${mode} failures containing ${fixture.name} reach the gateway reporter`, async () => {
      const failure = fixture.create()
      const reports: { error: Error; component: unknown }[] = []
      class Logger extends MemoryFunnelLogger {
        override info() {
          if (mode === "throw") throw failure
          return Promise.reject(failure)
        }
      }
      const gateway = new Funnel({
        logger: new Logger(),
        onError(error, context) {
          reports.push({ error, component: context?.component })
        },
      }).gatewayModule({ token: "" })
      try {
        await gateway.start()
        await Bun.sleep(0)
        expect(reports).toHaveLength(1)
        expect(reports[0]!.component).toBe("gateway-logger")
        if (fixture.name === "Error") expect(reports[0]!.error).toBe(failure)
        else expect(reports[0]!.error.message).toBe("Unprintable thrown value")
      } finally {
        await gateway.stop()
      }
    })
  }
}

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
