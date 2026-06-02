import { Database } from "bun:sqlite"

type Props = {
  /** SQLite file holding the raw (pre-filter) table. */
  rawPath: string
  /** SQLite file holding the processed (verdict) table. */
  processedPath: string
  /** SQLite file holding the connection (lifecycle) table. */
  connectionPath: string
}

type Row = Record<string, unknown>

/**
 * Read-only SQL surface over the three diagnostic tables, for Claude to query
 * the log with arbitrary `SELECT`s. It opens all files read-only and exposes
 * three views — `raw`, `processed`, `connection` — that hide the storage
 * details (the physical table is `leuco_log` and each row's columns live
 * inside a JSON `event` blob): the views surface the columns as plain fields,
 * with `payload` already pulled out of the nested JSON.
 *
 * The tables are separate files. `raw` and `processed` share an `event_id`,
 * so a `JOIN` answers "the event arrived, but what verdict did it get?";
 * `connection` answers the other half — "did the listener ever connect at
 * all?". Writes are impossible: the connection is read-only and `query`
 * rejects anything but a single `SELECT`.
 */
export class ConnectorDiagnosticSqlReader {
  private readonly db: Database

  constructor(props: Props) {
    // Opening the raw file as the main connection and attaching the others
    // lets one query reference all three. All are read-only.
    const db = new Database(props.rawPath, { readonly: true })

    try {
      // The daemon writes these in WAL mode from another process; without a
      // timeout a query racing a checkpoint fails instantly with SQLITE_BUSY.
      db.run("PRAGMA busy_timeout = 500")
      db.prepare("ATTACH DATABASE ? AS processeddb").run(props.processedPath)
      db.prepare("ATTACH DATABASE ? AS connectiondb").run(props.connectionPath)
      db.run(rawViewSql)
      db.run(processedViewSql)
      db.run(connectionViewSql)
    } catch (error) {
      // ATTACH/view setup can throw on a corrupt or partially written file;
      // close the already-open handle before propagating so it does not leak.
      db.close()
      throw error
    }

    this.db = db
    Object.freeze(this)
  }

  /**
   * Run one read-only `SELECT` and return the rows. Returns an `Error` (rather
   * than throwing) for a non-SELECT statement or a SQL error, so the caller
   * can surface the message without a stack trace.
   */
  query(sql: string, params: (string | number | null)[] = []): Row[] | Error {
    const trimmed = sql.trim().replace(/;$/, "").trim()

    if (!/^select\b/i.test(trimmed)) {
      return new Error("only a single SELECT statement is allowed")
    }

    if (trimmed.includes(";")) {
      return new Error("only a single statement is allowed (remove the ';')")
    }

    try {
      return this.db.prepare<Row, (string | number | null)[]>(trimmed).all(...params)
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error))
    }
  }

  close(): void {
    this.db.close()
  }
}

// `main` is the attached raw file; `processeddb` is the processed file. Each
// row's fields live in the JSON `event` column, so the views extract them.
const rawViewSql = `CREATE TEMP VIEW raw AS SELECT
  seq,
  ts,
  json_extract(event, '$.event_id')     AS event_id,
  json_extract(event, '$.type')         AS type,
  json_extract(event, '$.connector_id') AS connector_id,
  json_extract(event, '$.channel_id')   AS channel_id,
  json_extract(event, '$.payload')      AS payload
FROM main.leuco_log`

const processedViewSql = `CREATE TEMP VIEW processed AS SELECT
  seq,
  ts,
  json_extract(event, '$.event_id')     AS event_id,
  json_extract(event, '$.type')         AS type,
  json_extract(event, '$.connector_id') AS connector_id,
  json_extract(event, '$.channel_id')   AS channel_id,
  json_extract(event, '$.outcome')      AS outcome,
  json_extract(event, '$.payload')      AS payload
FROM processeddb.leuco_log`

const connectionViewSql = `CREATE TEMP VIEW connection AS SELECT
  seq,
  ts,
  json_extract(event, '$.type')         AS type,
  json_extract(event, '$.connector_id') AS connector_id,
  json_extract(event, '$.channel_id')   AS channel_id,
  json_extract(event, '$.status')       AS status,
  json_extract(event, '$.detail')       AS detail
FROM connectiondb.leuco_log`
