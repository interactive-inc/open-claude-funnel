import { expect, test } from "bun:test"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const record = {
  content: "original",
  channelId: "ops",
  connectorId: "source",
  meta: null,
  offset: 1,
}

test("a failing logger cannot hide the original SQLite error from the host reporter", () => {
  const captured: Error[] = []
  class Logger extends MemoryFunnelLogger {
    override error(): void {
      throw new Error("logger failed")
    }
  }
  const store = new SqliteFunnelEventLog({
    path: ":memory:",
    logger: new Logger(),
    onError(error) {
      captured.push(error)
    },
  })
  try {
    store.record(record)
    let thrown: unknown
    try {
      store.record({ ...record, content: "duplicate" })
    } catch (error) {
      thrown = error
    }
    expect(captured).toHaveLength(1)
    expect(thrown).toBe(captured[0])
    expect(captured[0]?.message).toContain("UNIQUE constraint failed")
    expect(store.loadSince(0).map((event) => event.content)).toEqual(["original"])
  } finally {
    store.close()
  }
})

test("a failing host reporter cannot replace the original SQLite write error", () => {
  const logger = new MemoryFunnelLogger()
  const store = new SqliteFunnelEventLog({
    path: ":memory:",
    logger,
    onError() {
      throw new Error("reporter failed")
    },
  })
  try {
    store.record(record)
    expect(() => store.record(record)).toThrow("UNIQUE constraint failed")
    expect(logger.entries.filter((entry) => entry.level === "error")).toHaveLength(1)
  } finally {
    store.close()
  }
})

test("async SQLite error sinks are independently observed without unhandled rejections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "funnel-sqlite-errors-"))
  const script = join(dir, "sqlite-errors.ts")
  await Bun.write(
    script,
    `
    import { SqliteFunnelEventLog } from ${JSON.stringify(import.meta.resolve("@/gateway/event-log/sqlite-event-log"))}
    import { MemoryFunnelLogger } from ${JSON.stringify(import.meta.resolve("@/engine/logger/memory-logger"))}
    const state = { unhandled: 0, logged: 0, reported: 0, originalFailure: false }
    process.on("unhandledRejection", () => { state.unhandled++ })
    class Logger extends MemoryFunnelLogger {
      async error() { state.logged++; throw new Error("logger failed") }
    }
    const store = new SqliteFunnelEventLog({
      path: ":memory:", logger: new Logger(),
      onError: async () => { state.reported++; throw new Error("reporter failed") },
    })
    const record = ${JSON.stringify(record)}
    store.record(record)
    try { store.record(record) }
    catch (error) { state.originalFailure = error.message.includes("UNIQUE constraint failed") }
    store.close()
    await Bun.sleep(10)
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
      logged: 1,
      reported: 1,
      originalFailure: true,
    })
  } finally {
    child.kill()
    await child.exited
    rmSync(dir, { recursive: true, force: true })
  }
})
