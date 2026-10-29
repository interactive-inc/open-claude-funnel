import { expect, test } from "bun:test"
import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

for (const storage of ["generic", "replay", "diagnostic"] as const) {
  for (const invalid of ["empty", "blank", "null", "uri", "encoded-uri", "memory-uri"] as const) {
    test(`${storage} rejects ${invalid} paths before filesystem or database changes`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "funnel-path-validation-"))
      const plain = join(directory, "raw.db")
      const path = {
        empty: "",
        blank: " \t\u00a0",
        null: join(directory, "nested", "events.db") + "\0ignored",
        uri: " \tfile:" + plain + "?mode=rwc ",
        "encoded-uri": "file:" + join(directory, "%72aw.db") + "?mode=rwc",
        "memory-uri": "file:shared?mode=memory&cache=shared",
      }[invalid]
      const expected =
        invalid === "empty" || invalid === "blank"
          ? "SQLite path must not be empty"
          : invalid === "null"
            ? "SQLite path must not contain null bytes"
            : "SQLite URI paths are not supported; use a filesystem path or :memory:"
      const source = `
import { SqliteEventLog } from ${JSON.stringify(new URL("./sqlite-event-log.ts", import.meta.url).href)}
import { SqliteFunnelEventLog, SqliteConnectorDiagnosticLog } from ${JSON.stringify(new URL("../sqlite.ts", import.meta.url).href)}
const props = ${JSON.stringify({ storage, path, plain, connection: join(directory, "connection.db") })}
let log
let error = null
try {
  log = props.storage === "generic" ? new SqliteEventLog({ path: props.path })
    : props.storage === "replay" ? new SqliteFunnelEventLog({ path: props.path })
    : new SqliteConnectorDiagnosticLog({ rawPath: props.plain, processedPath: props.path, connectionPath: props.connection })
} catch (failure) { error = failure instanceof Error ? failure.message : String(failure) }
finally { log?.close() }
console.log(JSON.stringify({ error }))
`
      try {
        // Keep native path interpretation inside the fixture if validation regresses.
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
        expect({ errors, exit }).toEqual({ errors: "", exit: 0 })
        expect(JSON.parse(output)).toEqual({ error: expected })
        expect(readdirSync(directory)).toEqual([])
      } finally {
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}
