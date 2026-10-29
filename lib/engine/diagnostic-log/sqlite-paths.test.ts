import { expect, test } from "bun:test"
import { existsSync, linkSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"

for (const alias of [
  "same",
  "normalized",
  "directory-symlink",
  "file-symlink",
  "hardlink",
] as const) {
  test(`diagnostic databases reject ${alias} aliases before opening or creating files`, () => {
    const directory = mkdtempSync(join(tmpdir(), "funnel-diagnostic-paths-"))
    const rawPath = join(directory, "raw.db")
    const connectionPath = join(directory, "connection.db")
    let processedPath = rawPath
    try {
      if (alias === "normalized") processedPath = `${directory}/nested/../raw.db`
      if (alias === "directory-symlink") {
        symlinkSync(directory, join(directory, "alias"))
        processedPath = join(directory, "alias", "raw.db")
      }
      if (alias === "file-symlink" || alias === "hardlink") {
        writeFileSync(rawPath, "preserved")
        processedPath = join(directory, "alias.db")
        if (alias === "file-symlink") symlinkSync(rawPath, processedPath)
        else linkSync(rawPath, processedPath)
      }
      expect(
        () => new SqliteConnectorDiagnosticLog({ rawPath, processedPath, connectionPath }),
      ).toThrow("diagnostic database paths must identify separate files")
      expect(existsSync(connectionPath)).toBe(false)
      expect(existsSync(`${rawPath}-wal`)).toBe(false)
      if (alias !== "file-symlink" && alias !== "hardlink") expect(existsSync(rawPath)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test("separate databases under a missing parent and independent memory databases remain supported", () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-diagnostic-paths-"))
  try {
    for (const prefix of [":memory:", join(directory, "nested")]) {
      const paths =
        prefix === ":memory:"
          ? { rawPath: prefix, processedPath: prefix, connectionPath: prefix }
          : {
              rawPath: join(prefix, "raw.db"),
              processedPath: join(prefix, "processed.db"),
              connectionPath: join(prefix, "connection.db"),
            }
      const log = new SqliteConnectorDiagnosticLog(paths)
      try {
        log.recordRaw({
          eventId: "input",
          type: "example",
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
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

for (const field of ["rawPath", "processedPath"] as const) {
  test(`connection path cannot alias ${field}`, () => {
    const directory = mkdtempSync(join(tmpdir(), "funnel-diagnostic-paths-"))
    try {
      const paths = {
        rawPath: join(directory, "raw.db"),
        processedPath: join(directory, "processed.db"),
        connectionPath: "",
      }
      paths.connectionPath = paths[field]
      expect(() => new SqliteConnectorDiagnosticLog(paths)).toThrow(
        "diagnostic database paths must identify separate files",
      )
      expect(existsSync(paths.rawPath)).toBe(false)
      expect(existsSync(paths.processedPath)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
}

test("dangling database symlinks are rejected before any database is created", () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-diagnostic-paths-"))
  const rawPath = join(directory, "raw.db")
  const processedPath = join(directory, "alias.db")
  try {
    symlinkSync(rawPath, processedPath)
    expect(
      () =>
        new SqliteConnectorDiagnosticLog({
          rawPath,
          processedPath,
          connectionPath: join(directory, "connection.db"),
        }),
    ).toThrow("dangling symbolic links")
    expect(existsSync(rawPath)).toBe(false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
