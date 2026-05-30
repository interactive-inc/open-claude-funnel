import { z } from "zod"

/**
 * Points in the listener's connection lifecycle. The single source of truth
 * for the value set: the `status` column schema, the `ConnectorConnectionStatus`
 * union, and the runtime Set used to narrow on read-back all derive from this
 * array, so adding a status is a one-line change that cannot drift out of sync.
 *
 *   started       start() was called
 *   connected     the socket opened and events can flow
 *   disconnected  the socket was closed by a stop() call (a clean teardown)
 *   auth-failed   the token was rejected before the socket opened
 *   stopped       the listener was fully torn down (always follows a stop(),
 *                 paired with the disconnected/error that preceded it)
 *   error         start/stop threw, or Bolt surfaced an error frame — this is
 *                 also where an unsolicited socket drop shows up when Bolt
 *                 reports it (an `error` with no following `stopped` means the
 *                 supervisor recycled the listener, not a clean stop)
 *
 * A connection row is independent of any single inbound event, so it carries
 * no `eventId`. This is how "no notification arrived because the listener
 * never connected (or dropped, or failed auth)" becomes visible: the
 * raw/processed tables only hold events that *did* arrive.
 */
export const CONNECTOR_CONNECTION_STATUSES = [
  "started",
  "connected",
  "disconnected",
  "auth-failed",
  "stopped",
  "error",
] as const

export type ConnectorConnectionStatus = (typeof CONNECTOR_CONNECTION_STATUSES)[number]

/**
 * Rows stored in the diagnostic tables. Connector-agnostic on purpose: `type`
 * carries the listener kind ("slack" | "discord" | "gh" | "schedule") so new
 * connectors land in the same tables without a schema change. `event_id` is
 * the correlation key the listener mints once per inbound event and stamps
 * onto both the raw and processed rows, so the two are joinable even though
 * they live in separate tables with independent `seq` counters.
 *
 * These schemas mirror the stored shape (snake_case columns) the way
 * `FunnelEvent` does for the replay log; they exist for `z.infer` and to
 * document the column set, not as a parse boundary.
 */
export const connectorRawEventSchema = z.object({
  event_id: z.string(),
  type: z.string(),
  connector_id: z.string().nullable(),
  channel_id: z.string().nullable(),
  payload: z.string(),
})

export type ConnectorRawEvent = z.infer<typeof connectorRawEventSchema>

export const connectorProcessedEventSchema = z.object({
  event_id: z.string(),
  type: z.string(),
  connector_id: z.string().nullable(),
  channel_id: z.string().nullable(),
  outcome: z.string(),
  payload: z.string(),
})

export type ConnectorProcessedEvent = z.infer<typeof connectorProcessedEventSchema>

export const connectorConnectionEventSchema = z.object({
  type: z.string(),
  connector_id: z.string().nullable(),
  channel_id: z.string().nullable(),
  status: z.enum(CONNECTOR_CONNECTION_STATUSES),
  detail: z.string(),
})

export type ConnectorConnectionEvent = z.infer<typeof connectorConnectionEventSchema>

/** The connector a row belongs to — the axis every diagnostic table shares. */
type ConnectorRef = {
  type: string
  connectorId: string | null
  channelId: string | null
}

/** A row tied to one inbound event, joinable to its twin by `eventId`. */
type ConnectorEventKeys = ConnectorRef & {
  /** Correlation id shared by the raw and processed rows of the same inbound event. */
  eventId: string
}

/** One untouched inbound event to persist, before any processing. */
export type ConnectorRawRecord = ConnectorEventKeys & {
  /** The listener's untouched payload, already JSON-stringified by the caller. */
  payload: string
}

/** The processor's verdict for one inbound event. */
export type ConnectorProcessedRecord = ConnectorEventKeys & {
  /**
   * "emitted" on successful delivery, "emitted:delivery-failed" when the
   * downstream notify threw, or "skip:<reason>" when the processor dropped it.
   */
  outcome: string
  /**
   * The delivered body (content + meta) for an emitted event. For a skipped
   * event there is no body, so the listener records the event JSON here
   * instead — keeping a skipped row self-describing rather than blank.
   */
  payload: string
}

export type ConnectorConnectionRecord = ConnectorRef & {
  status: ConnectorConnectionStatus
  /** Free-form context (an error message, a reason) or "" when none. */
  detail: string
}

/**
 * Filters every table query accepts — the read-side mirror of `ConnectorRef`.
 * Each per-table query extends this with its own table's column, the same way
 * each record extends `ConnectorRef`, so neither half of the file treats one
 * table's shape as the base for the others.
 */
export type ConnectorQuery = {
  type?: string
  connectorId?: string | null
  channelId?: string | null
  /** Cap on returned rows. The most recent matching rows are returned, oldest first. */
  limit?: number
}

export type ConnectorRawQuery = ConnectorQuery

export type ConnectorProcessedQuery = ConnectorQuery & {
  outcome?: string
}

export type ConnectorConnectionQuery = ConnectorQuery & {
  status?: ConnectorConnectionStatus
}

/**
 * A stored row, ascending by `seq`. `seq` is per-table (each table counts
 * independently) and is for ordering within one table, not for correlating
 * across them — use `eventId` to join raw and processed.
 */
export type StoredRawEvent = ConnectorRawRecord & { seq: number; ts: number }
export type StoredProcessedEvent = ConnectorProcessedRecord & { seq: number; ts: number }
export type StoredConnectionEvent = ConnectorConnectionRecord & { seq: number; ts: number }

/**
 * Three-table diagnostic log of everything a connector listener does, so
 * "why was there no notification?" is answerable whichever way it failed:
 *   - `raw` — every inbound event, before any filtering, with the listener's
 *     untouched payload (the Slack Bolt event, the GH webhook, …)
 *   - `processed` — the verdict for that event: `outcome` (emitted, or the
 *     reason it was dropped) and, when emitted, the body that was delivered.
 *     Shares an `eventId` with its raw row, so the two join into one story.
 *   - `connection` — the listener's lifecycle (started, connected, dropped,
 *     auth-failed, stopped, errored). This is the half the event tables can't
 *     show: an event that never arrived leaves no raw row, but a listener that
 *     never connected leaves a `connection` trail that says so.
 *
 * The three are physically separate (independent retention and payload-size
 * policy) so a query never crosses them by accident and a huge raw payload
 * never bloats the verdict or lifecycle trails. None flow to WS clients or the
 * MCP channel — this is a separate store from `FunnelEventLog` (replay) and
 * exists solely for debugging.
 *
 * Implementations:
 *   - `SqliteConnectorDiagnosticLog` — the default; survives daemon restarts,
 *     bounded by per-table row/age caps.
 *   - `MemoryConnectorDiagnosticLog` — an in-process double for tests.
 */
export abstract class ConnectorDiagnosticLog {
  abstract recordRaw(record: ConnectorRawRecord): void

  abstract recordProcessed(record: ConnectorProcessedRecord): void

  abstract recordConnection(record: ConnectorConnectionRecord): void

  abstract queryRaw(query: ConnectorRawQuery): StoredRawEvent[]

  abstract queryProcessed(query: ConnectorProcessedQuery): StoredProcessedEvent[]

  abstract queryConnection(query: ConnectorConnectionQuery): StoredConnectionEvent[]

  abstract close(): void
}
