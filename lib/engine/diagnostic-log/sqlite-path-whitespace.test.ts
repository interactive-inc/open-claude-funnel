import { expect, test } from "bun:test"
import { chmodSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"
import { requireSeparateDiagnosticPaths } from "@/engine/diagnostic-log/require-separate-paths"

for (const [label, whitespace] of [
  ["space", " "],
  ["tab", "\t"],
  ["unicode", "\u00a0"],
] as const) {
  for (const [first, second] of [
    ["rawPath", "processedPath"],
    ["rawPath", "connectionPath"],
    ["processedPath", "connectionPath"],
  ] as const) {
    test(`${label} at the end of ${second} cannot alias ${first}`, () => {
      const directory = mkdtempSync(join(tmpdir(), "funnel-path-whitespace-"))
      const paths = {
        rawPath: join(directory, "raw.db"),
        processedPath: join(directory, "processed.db"),
        connectionPath: join(directory, "connection.db"),
      }
      paths[second] = paths[first] + whitespace
      let log: SqliteConnectorDiagnosticLog | undefined
      try {
        expect(() => {
          log = new SqliteConnectorDiagnosticLog(paths)
        }).toThrow("diagnostic database paths must identify separate files")
        expect(readdirSync(directory)).toEqual([])
      } finally {
        log?.close()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}

for (const suffix of ["-wal", "-shm", "-journal"]) {
  test(`trimmed database paths reserve their actual ${suffix} sidecar`, () => {
    const directory = mkdtempSync(join(tmpdir(), "funnel-path-whitespace-"))
    const path = join(directory, "raw.db")
    let log: SqliteConnectorDiagnosticLog | undefined
    try {
      expect(() => {
        log = new SqliteConnectorDiagnosticLog({
          rawPath: path + " ",
          processedPath: path + suffix,
          connectionPath: join(directory, "connection.db"),
        })
      }).toThrow("diagnostic database paths must identify separate files")
      expect(readdirSync(directory)).toEqual([])
    } finally {
      log?.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test("leading whitespace is normalized before physical-file validation", () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-path-whitespace-"))
  const path = join(directory, "raw.db")
  try {
    expect(() => requireSeparateDiagnosticPaths([path, " \t" + path])).toThrow(
      "diagnostic database paths must identify separate files",
    )
    expect(readdirSync(directory)).toEqual([])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("permission hardening uses the same trimmed filenames as SQLite", () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-path-whitespace-"))
  const paths = ["raw.db", "processed.db", "connection.db"].map((name) => join(directory, name))
  let log: SqliteConnectorDiagnosticLog | undefined
  try {
    for (const path of paths) {
      new SqliteEventLog({ path }).close()
      chmodSync(path, 0o666)
    }
    log = new SqliteConnectorDiagnosticLog({
      rawPath: paths[0] + " ",
      processedPath: paths[1] + "\t",
      connectionPath: paths[2] + "\u00a0",
    })
    if (process.platform !== "win32") {
      for (const path of paths) expect(statSync(path).mode & 0o777).toBe(0o600)
    }
    log.recordRaw({
      eventId: "input",
      type: "source",
      channelId: null,
      connectorId: null,
      payload: "{}",
    })
    expect(log.queryRaw({})).toHaveLength(1)
    expect(log.queryProcessed({})).toEqual([])
    expect(log.queryConnection({})).toEqual([])
  } finally {
    log?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test("trimmed memory sentinels remain independent diagnostic databases", () => {
  const log = new SqliteConnectorDiagnosticLog({
    rawPath: ":memory: ",
    processedPath: ":memory:\t",
    connectionPath: ":memory:\u00a0",
  })
  try {
    log.recordRaw({
      eventId: "input",
      type: "source",
      channelId: null,
      connectorId: null,
      payload: "{}",
    })
    expect(log.queryRaw({})).toHaveLength(1)
    expect(log.queryProcessed({})).toEqual([])
    expect(log.queryConnection({})).toEqual([])
  } finally {
    log.close()
  }
})

test("replay storage creates the trimmed missing parent without unrelated directories", async () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-path-whitespace-"))
  const path = join(directory, "nested", "events.db")
  const source = `
import { SqliteFunnelEventLog } from ${JSON.stringify(new URL("../../gateway/event-log/sqlite-event-log.ts", import.meta.url).href)}
const log = new SqliteFunnelEventLog({ path: ${JSON.stringify(" \t" + path + "\u00a0")} })
try { log.record({ offset: 1, content: "input", channelId: null, connectorId: null, meta: null }) }
finally { log.close() }
`
  try {
    const child = Bun.spawn([process.execPath, "-e", source], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [output, errors, exit] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    expect({ output, errors, exit }).toEqual({ output: "", errors: "", exit: 0 })
    expect(readdirSync(directory)).toEqual(["nested"])
    const log = new SqliteEventLog({ path })
    try {
      expect(log.query()).toHaveLength(1)
    } finally {
      log.close()
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
