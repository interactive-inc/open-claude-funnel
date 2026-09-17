import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SQLITE_BUSY_TIMEOUT_MS } from "@/event-log/sqlite-busy-timeout"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

const isBun = typeof globalThis.Bun !== "undefined"

// Another process holds a write transaction for `holdMs`, as a restarting
// daemon does, and signals once the lock is taken.
const holderScript = `
import { Database } from "bun:sqlite"
const [path, holdMs] = process.argv.slice(2)
const db = new Database(path)
db.run("PRAGMA journal_mode = WAL")
db.run("BEGIN IMMEDIATE")
db.run("CREATE TABLE IF NOT EXISTS hold (x INTEGER)")
console.log("locked")
await Bun.sleep(Number(holdMs))
db.run("COMMIT")
db.close()
`

describe.skipIf(!isBun)("SqliteEventLog under a concurrent writer", () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  async function holdLock(path: string, holdMs: number) {
    const dir = mkdtempSync(join(tmpdir(), "funnel-busy-"))
    dirs.push(dir)
    const script = join(dir, "holder.ts")
    await Bun.write(script, holderScript)
    const child = Bun.spawn([process.execPath, script, path, String(holdMs)], { stdout: "pipe" })
    const reader = child.stdout.getReader()
    const { value } = await reader.read()
    expect(new TextDecoder().decode(value)).toContain("locked")
    reader.releaseLock()
    return child
  }

  function tempPath(name: string) {
    const dir = mkdtempSync(join(tmpdir(), "funnel-busy-db-"))
    dirs.push(dir)
    return join(dir, name)
  }

  it("waits for the lock instead of failing on open", async () => {
    const path = tempPath("events.db")
    const child = await holdLock(path, 300)
    const log = new SqliteEventLog<{ type: string }>({ path })
    expect(log.insert({ ts: 1, event: { type: "x" } })).not.toBeInstanceOf(Error)
    log.close()
    expect(await child.exited).toBe(0)
  })

  it("opens the diagnostic log while the daemon is writing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "funnel-busy-diag-"))
    dirs.push(dir)
    const rawPath = join(dir, "raw.db")
    const child = await holdLock(rawPath, 300)
    const log = new SqliteConnectorDiagnosticLog({
      rawPath,
      processedPath: join(dir, "processed.db"),
      connectionPath: join(dir, "connection.db"),
    })
    log.close()
    expect(await child.exited).toBe(0)
  })

  it("still fails once the timeout is exceeded", async () => {
    const path = tempPath("events.db")
    const child = await holdLock(path, SQLITE_BUSY_TIMEOUT_MS + 2000)
    try {
      expect(() => new SqliteEventLog<{ type: string }>({ path })).toThrow(/database is locked/)
    } finally {
      child.kill()
      await child.exited
    }
  }, 15_000)
})
