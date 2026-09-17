import { Database } from "bun:sqlite"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

// A failed constructor must close whatever it opened; callers retry, and each
// leaked handle stays open for the life of the daemon.
describe("SQLite stores close handles when opening fails", () => {
  const dirs: string[] = []
  let opened: Database[] = []
  let closed: Database[] = []
  let openSpy: ReturnType<typeof spyOn>
  let closeSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    opened = []
    closed = []
    const originalClose = Database.prototype.close
    closeSpy = spyOn(Database.prototype, "close").mockImplementation(function (
      this: Database,
      ...args: Parameters<Database["close"]>
    ) {
      closed.push(this)
      return originalClose.apply(this, args)
    })
    const originalRun = Database.prototype.run
    openSpy = spyOn(Database.prototype, "run").mockImplementation(function (
      this: Database,
      ...args: Parameters<Database["run"]>
    ) {
      if (!opened.includes(this)) opened.push(this)
      return originalRun.apply(this, args)
    })
  })

  afterEach(() => {
    closeSpy.mockRestore()
    openSpy.mockRestore()
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  function tempDir() {
    const dir = mkdtempSync(join(tmpdir(), "funnel-open-failure-"))
    dirs.push(dir)
    return dir
  }

  it("rejects invalid index names before opening anything", () => {
    const path = join(tempDir(), "events.db")
    const invalid = {
      path,
      indexes: ["bad name"],
      extractIndexes: () => ({ "bad name": null }),
    } as const
    expect(() => new SqliteEventLog<{ type: string }, readonly ["bad name"]>(invalid)).toThrow(
      /invalid index column name/,
    )
    expect(opened).toHaveLength(0)
  })

  it("closes the handle when a statement after open fails", () => {
    const path = join(tempDir(), "events.db")
    const seed = new Database(path)
    seed.run("PRAGMA user_version = 1")
    seed.run("CREATE TABLE logs (unrelated TEXT)")
    seed.close()
    opened = []
    closed = []
    expect(() => new SqliteEventLog<{ type: string }>({ path })).toThrow()
    expect(opened).toHaveLength(1)
    expect(closed).toEqual(opened)
  })

  it("closes the diagnostic files already opened when a later one fails", () => {
    const dir = tempDir()
    const connectionPath = join(dir, "connection.db")
    mkdirSync(connectionPath)
    expect(
      () =>
        new SqliteConnectorDiagnosticLog({
          rawPath: join(dir, "raw.db"),
          processedPath: join(dir, "processed.db"),
          connectionPath,
        }),
    ).toThrow()
    expect(opened).toHaveLength(2)
    expect(closed).toEqual(expect.arrayContaining(opened))
  })
})
