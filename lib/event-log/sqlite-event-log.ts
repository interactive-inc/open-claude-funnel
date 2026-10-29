import { requireTimestamp } from "@/require-timestamp"
import { normalizeError } from "@/engine/error/error-message-of"
import { requireDurationLimit, requireIntegerLimit } from "@/require-limit"
import { Database } from "bun:sqlite"
import { applySqliteBusyTimeout } from "@/event-log/sqlite-busy-timeout"
import type { SQLQueryBindings, Statement } from "bun:sqlite"
import { existsSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"
import type { EventLogEntry } from "@/event-log/event-log-entry"
import type { EventLogStore, EventLogRelay } from "@/event-log/event-log-store"

type IndexValues<I extends ReadonlyArray<string>> = Record<I[number], string | null>
type IndexPrefixes<I extends ReadonlyArray<string>> = Partial<Record<I[number], string>>
type IndexSets<I extends ReadonlyArray<string>> = Partial<
  Record<I[number], ReadonlyArray<string | null>>
>

/**
 * Constructor props. The shape narrows on `I`: when no indexes are
 * declared (the default), `extractIndexes` is forbidden; when indexes
 * are declared, both `indexes` and `extractIndexes` are required and
 * `extractIndexes` is type-checked against the index keys.
 */
export type SqliteEventLogProps<E, I extends ReadonlyArray<string>> = I extends readonly []
  ? {
      path: string
      maxRows?: number
      maxAgeMs?: number
      maxBytes?: number
      targetBytes?: number
      now?: () => number
      /** Post-commit compaction failure. Does not change the successful write result. */
      onMaintenanceError?: (error: Error) => void
      indexes?: I
      extractIndexes?: never
    }
  : {
      path: string
      maxRows?: number
      maxAgeMs?: number
      maxBytes?: number
      targetBytes?: number
      now?: () => number
      /** Post-commit compaction failure. Does not change the successful write result. */
      onMaintenanceError?: (error: Error) => void
      indexes: I
      extractIndexes: (event: E) => IndexValues<I>
    }

export type SqliteEventLogQuery<I extends ReadonlyArray<string>> = {
  /** Non-negative safe integer. Return only records with seq strictly greater than this. */
  sinceSeq?: number
  /** Non-negative safe integer. Match one sequence number exactly instead of using `sinceSeq`. */
  seq?: number
  /** Filter by the top-level `event.type` discriminator. */
  type?: string
  /** Filter by indexed columns. Keys are constrained to the declared `indexes`. */
  where?: Partial<IndexValues<I>>
  /** Case-sensitive literal prefix match, including embedded null characters. */
  wherePrefix?: IndexPrefixes<I>
  /** Match any value in a set for indexed columns. */
  whereIn?: IndexSets<I>
  /** Maximum rows returned, as a non-negative safe integer. Default 1000; zero returns no rows. */
  limit?: number
  /**
   * Which end of the seq range to take when `limit` clips the result.
   * "asc" (default) returns the oldest matching rows; "desc" returns the
   * newest. Rows are always sorted ascending by seq before returning, so the
   * caller sees a chronological slice either way — "desc" just picks the tail.
   */
  order?: "asc" | "desc"
}

type EventRow = {
  seq: number
  ts: number
  type: string | null
  event: string
}

type CountRow = { n: number }
type MaxRow = { max: number }
type VersionRow = { user_version: number }
type ColumnRow = { name: string }
type PageCountRow = { page_count: number }
type PageSizeRow = { page_size: number }

/** Conservative whitelist for column names interpolated into SQL. */
const COLUMN_NAME_RE = /^[a-z_][a-z0-9_]*$/

/** How many inserts between on-disk size checks (see insertsSinceByteCheck). */
const BYTE_CHECK_INTERVAL = 500

const RESERVED_COLUMNS: ReadonlySet<string> = new Set(["seq", "ts", "type", "event"])

/**
 * Schema versions. Each entry is the list of DDL statements that take the
 * database from version i to version i + 1. Migrations run in a transaction
 * so a partial failure rolls back. Adding a new version is append-only —
 * never edit a published one. Caller-defined index columns are added
 * dynamically on construct (independent of versioned migrations) because
 * they are configuration, not schema evolution.
 */
const MIGRATIONS: ReadonlyArray<ReadonlyArray<string>> = [
  [
    "CREATE TABLE IF NOT EXISTS logs (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, type TEXT, event TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts)",
    "CREATE INDEX IF NOT EXISTS idx_logs_type ON logs (type)",
  ],
  [
    "DROP TABLE IF EXISTS leuco_log",
    "CREATE TABLE IF NOT EXISTS logs (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, type TEXT, event TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs (ts)",
    "CREATE INDEX IF NOT EXISTS idx_logs_type ON logs (type)",
  ],
  [
    "CREATE TABLE IF NOT EXISTS log_sequence (id INTEGER PRIMARY KEY CHECK (id = 1), seq INTEGER NOT NULL)",
    "INSERT OR IGNORE INTO log_sequence (id, seq) SELECT 1, COALESCE(MAX(seq), 0) FROM logs",
  ],
]

/**
 * SQLite-backed sink built on `bun:sqlite`. Implements both primary and
 * relay roles so the same instance can own seq generation for one log and
 * mirror records from another (e.g. cross-process replication, restore
 * from a backup stream).
 *
 * Concurrency model: a one-row sequence table and the payload are updated in
 * the same write transaction. Two processes share a monotonically increasing
 * stream even after retention or clear removes all payloads. Relay writes
 * advance the same watermark without moving it backwards.
 *
 * Schema is version-managed via `PRAGMA user_version`. Migrations are
 * append-only and run in a transaction on every construct so a partial
 * upgrade rolls back cleanly. Caller-defined `indexes` are layered on top
 * via `ALTER TABLE ADD COLUMN` + `CREATE INDEX IF NOT EXISTS`, so adding
 * a new index to an existing database is a no-downtime operation.
 *
 * Type safety: the second generic parameter `I` is the literal tuple of
 * index column names. `extractIndexes` and `query({ where })` are
 * both type-checked against this tuple, so a typo at the call site is a
 * compile-time error rather than a silent miss at runtime.
 *
 * Retention is bounded by `maxRows` and/or `maxAgeMs`. Both run on every
 * insert as an indexed DELETE in the payload/sequence transaction. Byte-cap
 * deletions use the same transaction; VACUUM runs after commit and reports
 * compaction failures separately without changing the successful write result.
 *
 * Bulk inserts use `insertMany`, which wraps the batch in one transaction
 * for ~10–100x throughput at the cost of one fsync per batch instead of
 * one per row.
 */
export class SqliteEventLog<E, const I extends ReadonlyArray<string> = readonly []>
  implements EventLogStore<E>, EventLogRelay<E>
{
  private readonly db: Database
  private readonly maxRows: number | null
  private readonly maxAgeMs: number | null
  private readonly maxBytes: number | null
  private readonly targetBytes: number | null
  private readonly now: () => number
  private readonly onMaintenanceError: ((error: Error) => void) | undefined
  private readonly indexes: I
  private readonly extractIndexes: ((event: E) => IndexValues<I>) | null
  private readonly insertWithSeqStmt: Statement<unknown, SQLQueryBindings[]>
  private readonly nextSeqStmt: Statement<MaxRow, []>
  private readonly advanceSeqStmt: Statement<unknown, [number]>
  private readonly maxSeqStmt: Statement<MaxRow, []>
  private readonly countStmt: Statement<CountRow, []>
  private readonly trimRowsStmt: Statement<unknown, [number]>
  private readonly trimAgeStmt: Statement<unknown, [number]>
  private readonly trimOldestStmt: Statement<unknown, [number]>
  // Byte-size trimming is expensive (a VACUUM rewrites the file), so it is not
  // run on every insert like row/age trimming. Instead the sink counts inserts
  // and only checks the on-disk size every BYTE_CHECK_INTERVAL writes; on
  // overflow it deletes oldest rows down to targetBytes and VACUUMs once. The
  // gap between maxBytes and targetBytes means that check runs rarely (the file
  // has to refill the whole delta before the next overflow).
  private insertsSinceByteCheck = 0

  constructor(props: SqliteEventLogProps<E, I>) {
    this.maxRows =
      props.maxRows === undefined ? null : requireIntegerLimit(props.maxRows, "maxRows")
    this.maxAgeMs =
      props.maxAgeMs === undefined ? null : requireDurationLimit(props.maxAgeMs, "maxAgeMs")
    this.maxBytes =
      props.maxBytes === undefined ? null : requireIntegerLimit(props.maxBytes, "maxBytes")
    this.targetBytes =
      props.targetBytes === undefined
        ? this.maxBytes === null
          ? null
          : Math.floor(this.maxBytes / 4)
        : requireIntegerLimit(props.targetBytes, "targetBytes")
    if (this.targetBytes !== null && (this.maxBytes === null || this.targetBytes > this.maxBytes))
      throw new RangeError("targetBytes requires maxBytes and must not exceed it")
    // Snapshot before validation: callers can retain and mutate the input array.
    const indexes = Object.freeze([...(props.indexes ?? [])]) as unknown as I
    if (indexes.length > 0) validateIndexNames(indexes)

    // `bun:sqlite` does not create the parent directory on open, so a fresh
    // environment errors out with an opaque `unable to open database file`.
    // Create it here. `:memory:` is a sentinel handled by SQLite, not a path,
    // so skip it.
    if (props.path !== ":memory:") {
      const dir = dirname(props.path)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    }
    this.db = new Database(props.path)
    // Anything after open can throw (lock timeout, disk, schema). Close the
    // handle so a failed constructor does not leak it to the caller's retry.
    try {
      applySqliteBusyTimeout(this.db)
      const version = this.getSchemaVersion()
      if (version < 0 || version > MIGRATIONS.length)
        throw new Error(`unsupported event log schema version: ${version}`)
      this.db.run("PRAGMA journal_mode = WAL")
      this.migrate(version)

      this.now = props.now ?? (() => Date.now())
      this.onMaintenanceError = props.onMaintenanceError

      this.indexes = indexes

      if (this.indexes.length > 0) {
        this.extractIndexes = props.extractIndexes ?? null
        this.syncIndexColumns()
      } else {
        this.extractIndexes = null
      }

      const cols = ["ts", "type", "event", ...this.indexes]
      // Database.query owns its cached statements and finalizes them on close.
      // Unmanaged prepare() statements keep SQLite file handles alive after close_v2.
      const colsWithSeq = ["seq", ...cols]
      const placeholdersWithSeq = colsWithSeq.map(() => "?").join(", ")
      this.insertWithSeqStmt = this.db.query(
        `INSERT INTO logs (${colsWithSeq.map(quoteIdentifier).join(", ")}) VALUES (${placeholdersWithSeq})`,
      )

      this.nextSeqStmt = this.db.query(
        "UPDATE log_sequence SET seq = seq + 1 WHERE id = 1 RETURNING seq AS max",
      )
      this.advanceSeqStmt = this.db.query("UPDATE log_sequence SET seq = MAX(seq, ?) WHERE id = 1")
      this.maxSeqStmt = this.db.query("SELECT seq AS max FROM log_sequence WHERE id = 1")
      this.countStmt = this.db.query("SELECT COUNT(*) AS n FROM logs")
      this.trimRowsStmt = this.db.query(
        "DELETE FROM logs WHERE seq <= (SELECT seq FROM logs ORDER BY seq DESC LIMIT 1 OFFSET ?)",
      )
      this.trimAgeStmt = this.db.query("DELETE FROM logs WHERE ts < ?")
      this.trimOldestStmt = this.db.query(
        "DELETE FROM logs WHERE seq IN (SELECT seq FROM logs ORDER BY seq ASC LIMIT ?)",
      )
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  insert(input: { ts: number; event: E }): EventLogEntry<E> | Error {
    try {
      const { ts, event } = input
      const params = this.buildInsertParams(ts, event)
      const result = this.db.transaction(() => {
        const seq = this.nextSequence()
        this.insertWithSeqStmt.run(seq, ...params)
        return { record: { seq, ts, event }, compact: this.trim() }
      })()
      this.compact(result.compact)
      return result.record
    } catch (e) {
      return normalizeError(e)
    }
  }

  insertMany(inputs: ReadonlyArray<{ ts: number; event: E }>): EventLogEntry<E>[] | Error {
    if (inputs.length === 0) return []

    try {
      const records: EventLogEntry<E>[] = []
      const apply = this.db.transaction((batch: ReadonlyArray<{ ts: number; event: E }>) => {
        for (const input of batch) {
          const { ts, event } = input
          const params = this.buildInsertParams(ts, event)
          const seq = this.nextSequence()
          this.insertWithSeqStmt.run(seq, ...params)
          records.push({
            seq,
            ts,
            event,
          })
        }
        return this.trim()
      })
      this.compact(apply(inputs))
      return records
    } catch (e) {
      return normalizeError(e)
    }
  }

  write(record: EventLogEntry<E>): void | Error {
    try {
      const seq = record.seq
      if (!Number.isSafeInteger(seq) || seq < 1)
        throw new Error("event log sequence must be a positive safe integer")
      const { ts, event } = record
      const params: SQLQueryBindings[] = [seq, ...this.buildInsertParams(ts, event)]
      const compact = this.db.transaction(() => {
        this.insertWithSeqStmt.run(...params)
        this.advanceSeqStmt.run(seq)
        return this.trim()
      })()
      this.compact(compact)
    } catch (e) {
      return normalizeError(e)
    }
  }

  getMaxSeq(): number {
    const row = this.maxSeqStmt.get()
    return row ? row.max : 0
  }

  query(props: SqliteEventLogQuery<I> = {}): EventLogEntry<E>[] {
    const requestedLimit = props.limit
    const limit = requireIntegerLimit(requestedLimit === undefined ? 1000 : requestedLimit, "limit")
    const conditions: string[] = []
    const params: SQLQueryBindings[] = []

    const seq = props.seq
    if (seq !== undefined) {
      conditions.push("seq = ?")
      params.push(requireIntegerLimit(seq, "seq"))
    } else {
      conditions.push("seq > ?")
      const sinceSeq = props.sinceSeq
      params.push(requireIntegerLimit(sinceSeq === undefined ? 0 : sinceSeq, "sinceSeq"))
    }

    const type = props.type
    if (typeof type === "string") {
      conditions.push("type = ?")
      params.push(type)
    }

    const where = props.where
    if (where) {
      this.appendWhereConditions(where, conditions, params)
    }

    const wherePrefix = props.wherePrefix
    if (wherePrefix) {
      this.appendPrefixConditions(wherePrefix, conditions, params)
    }

    const whereIn = props.whereIn
    if (whereIn) {
      this.appendSetConditions(whereIn, conditions, params)
    }

    params.push(limit)

    // "desc" selects the newest `limit` rows at the DB; we then re-sort them
    // ascending in JS so the returned slice is always chronological regardless
    // of which end the limit clipped.
    const dir = props.order === "desc" ? "DESC" : "ASC"
    const sql = `SELECT seq, ts, type, event FROM logs WHERE ${conditions.join(" AND ")} ORDER BY seq ${dir} LIMIT ?`
    // Dynamic IN-list lengths can exceed Bun's bounded query cache. Own these
    // statements explicitly so even uncached queries release their file handles.
    const stmt = this.db.prepare<EventRow, SQLQueryBindings[]>(sql)
    try {
      const rows = stmt.all(...params)
      if (dir === "DESC") rows.reverse()
      return rows.map(toRecord<E>)
    } finally {
      stmt.finalize()
    }
  }

  /**
   * Current schema version. Useful for diagnostics and for tests that want
   * to verify migrations ran. Reads `PRAGMA user_version` once per call.
   */
  getSchemaVersion(): number {
    const row = this.db.query<VersionRow, []>("PRAGMA user_version").get()
    return row?.user_version ?? 0
  }

  close(): void {
    this.db.close()
  }

  private buildInsertParams(ts: number, event: E): SQLQueryBindings[] {
    requireTimestamp(ts)
    const type = extractType(event)
    const json = JSON.stringify(event)
    if (this.indexes.length === 0) return [ts, type, json]

    // The user's typed Record<I[number], V> is structurally a string-keyed
    // object at runtime; widen so we can index by `col: string` from the loop.
    const values = this.extractIndexes
      ? (this.extractIndexes(event) as unknown as Record<string, string | null>)
      : null
    const indexParams = this.indexes.map((col) => values?.[col] ?? null)
    return [ts, type, json, ...indexParams]
  }

  /** Allocate under the same write transaction as the payload; failed writes roll back both. */
  private nextSequence(): number {
    const row = this.nextSeqStmt.get()
    if (!row || !Number.isSafeInteger(row.max))
      throw new Error("event log sequence is missing or exceeds the safe integer range")

    return row.max
  }

  private appendWhereConditions(
    where: Partial<IndexValues<I>>,
    conditions: string[],
    params: SQLQueryBindings[],
  ): void {
    for (const col of this.indexKeys()) {
      const value = where[col]
      if (value === undefined) continue
      const column = quoteIdentifier(col)
      if (value === null) {
        conditions.push(`${column} IS NULL`)
      } else {
        conditions.push(`${column} = ?`)
        params.push(value)
      }
    }
  }

  private appendPrefixConditions(
    prefixes: IndexPrefixes<I>,
    conditions: string[],
    params: SQLQueryBindings[],
  ): void {
    for (const col of this.indexKeys()) {
      const value = prefixes[col]
      if (value === undefined) continue

      conditions.push(`instr(${quoteIdentifier(col)}, ?) = 1`)
      params.push(value)
    }
  }

  private appendSetConditions(
    sets: IndexSets<I>,
    conditions: string[],
    params: SQLQueryBindings[],
  ): void {
    for (const col of this.indexKeys()) {
      const values = sets[col]
      if (values === undefined) continue
      if (values.length === 0) {
        conditions.push("1 = 0")
        continue
      }

      const nonNull = values.filter((value): value is string => value !== null)
      const hasNull = nonNull.length !== values.length
      const alternatives: string[] = []
      const column = quoteIdentifier(col)

      if (nonNull.length > 0) {
        alternatives.push(`${column} IN (${nonNull.map(() => "?").join(", ")})`)
        params.push(...nonNull)
      }

      if (hasNull) alternatives.push(`${column} IS NULL`)

      conditions.push(`(${alternatives.join(" OR ")})`)
    }
  }

  private trim(): boolean {
    if (this.maxRows !== null) {
      const row = this.countStmt.get()
      if (row && row.n > this.maxRows) this.trimRowsStmt.run(this.maxRows)
    }

    if (this.maxAgeMs !== null) {
      this.trimAgeStmt.run(requireTimestamp(this.now()) - this.maxAgeMs)
    }

    return this.maybeTrimBytes()
  }

  private indexKeys(): ReadonlyArray<I[number]> {
    return this.indexes
  }

  /**
   * Throttled byte-size enforcement. Only every BYTE_CHECK_INTERVAL inserts do
   * we measure the file; on overflow we estimate how many of the oldest rows to
   * drop to land near targetBytes (by the byte/row ratio), delete them in one
   * statement, then VACUUM once to return the freed pages to the filesystem (a
   * plain DELETE only frees pages inside the file). One DELETE + one VACUUM per
   * overflow keeps the expensive rewrite rare — the file must refill the whole
   * maxBytes→targetBytes delta before the next overflow can trigger.
   */
  private maybeTrimBytes(): boolean {
    if (this.maxBytes === null || this.targetBytes === null) return false

    this.insertsSinceByteCheck += 1

    if (this.insertsSinceByteCheck < BYTE_CHECK_INTERVAL) return false

    this.insertsSinceByteCheck = 0

    const bytes = this.byteSize()

    if (bytes <= this.maxBytes) return false

    const rows = this.countStmt.get()?.n ?? 0

    if (rows === 0) return false

    // Drop enough of the oldest rows to bring the file to ~targetBytes, by the
    // current average bytes-per-row. Over/undershoot self-corrects next check.
    const bytesToFree = bytes - this.targetBytes
    const bytesPerRow = bytes / rows
    const rowsToDrop = Math.min(rows, Math.ceil(bytesToFree / bytesPerRow))

    this.trimOldestStmt.run(rowsToDrop)
    return true
  }

  /** VACUUM cannot run in a transaction; failure must not relabel a committed write. */
  private compact(needed: boolean): void {
    if (!needed) return
    try {
      this.db.run("VACUUM")
    } catch (error) {
      const failure = normalizeError(error)
      try {
        void Promise.resolve(this.onMaintenanceError?.(failure)).catch(() => {})
      } catch {}
    }
  }

  private byteSize(): number {
    const pageCount = this.db.query<PageCountRow, []>("PRAGMA page_count").get()?.page_count ?? 0
    const pageSize = this.db.query<PageSizeRow, []>("PRAGMA page_size").get()?.page_size ?? 0

    return pageCount * pageSize
  }

  /** Drop every row and reclaim the file space. Used by `<log>.clear()`. */
  clear(): void {
    this.db.run("DELETE FROM logs")
    this.compact(true)
    this.insertsSinceByteCheck = 0
  }

  private syncIndexColumns(): void {
    const existing = new Set(
      this.db
        .query<ColumnRow, []>("PRAGMA table_info(logs)")
        .all()
        .map((r) => r.name),
    )

    for (const col of this.indexes) {
      if (!existing.has(col)) {
        this.db.run(`ALTER TABLE logs ADD COLUMN ${quoteIdentifier(col)} TEXT`)
      }
      this.db.run(
        `CREATE INDEX IF NOT EXISTS ${quoteIdentifier(`idx_logs_${col}`)} ON logs (${quoteIdentifier(col)})`,
      )
    }
  }

  private migrate(current: number): void {
    if (current === MIGRATIONS.length) return

    const pending = MIGRATIONS.slice(current)
    let version = current

    for (const stmts of pending) {
      version += 1
      const apply = this.db.transaction(() => {
        for (const stmt of stmts) this.db.run(stmt)
        this.db.run(`PRAGMA user_version = ${version}`)
      })
      apply()
    }
  }
}

function validateIndexNames(names: ReadonlyArray<string>): void {
  const seen = new Set<string>()
  for (const name of names) {
    if (!COLUMN_NAME_RE.test(name)) {
      throw new Error(`invalid index column name: ${name}`)
    }
    if (RESERVED_COLUMNS.has(name)) {
      throw new Error(`reserved index column name: ${name}`)
    }
    if (seen.has(name)) throw new Error(`duplicate index column name: ${name}`)
    seen.add(name)
  }
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`
}

function extractType(event: unknown): string | null {
  if (typeof event !== "object" || event === null) return null
  if (!("type" in event)) return null
  const t = event.type
  return typeof t === "string" ? t : null
}

function toRecord<E>(row: EventRow): EventLogEntry<E> {
  return {
    seq: row.seq,
    ts: row.ts,
    event: JSON.parse(row.event),
  }
}
