import type { ConnectorDiagnosticSqlReader } from "@/gateway/connector-diagnostic-sql-reader"

/**
 * One diagnostic event row, normalized from the untyped SQL surface
 * (`ConnectorDiagnosticSqlReader` returns `Record<string, unknown>`). Every
 * field is narrowed with a runtime check, so a schema drift surfaces as a null
 * value rather than a wrong static type smuggled in through `as`.
 */
export type DebugEvent = {
  seq: number | null
  ts: number | null
  type: string
  outcome: string
  eventId: string | null
  payload: string | null
  payloadParsed: Record<string, unknown> | null
  preview: string | null
}

/** One connection-lifecycle error row, normalized the same way. */
export type DebugConnectionError = {
  seq: number | null
  ts: number | null
  type: string
  status: string
  detail: string | null
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" ? value : null

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback

/**
 * Parse a payload string as a JSON object. Returns null for non-strings,
 * malformed JSON, or any non-object JSON (arrays, primitives) — the callers
 * only ever want the object form.
 */
const parsePayloadObject = (payload: string | null): Record<string, unknown> | null => {
  if (payload === null) return null

  try {
    const parsed: unknown = JSON.parse(payload)

    if (isStringKeyedObject(parsed)) return parsed
  } catch {
    return null
  }

  return null
}

const isStringKeyedObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`

/**
 * A short human preview of a payload: the `text` field when the payload is a
 * JSON object that has one, otherwise the raw payload, both truncated.
 */
export const previewOf = (payload: unknown): string | null => {
  if (typeof payload !== "string" || payload.length === 0) return null

  const parsed = parsePayloadObject(payload)

  if (parsed !== null && "text" in parsed) {
    return truncate(String(parsed.text), 60)
  }

  return truncate(payload, 60)
}

/** Narrow one processed-table row into a `DebugEvent`. */
export const toDebugEvent = (row: Record<string, unknown>): DebugEvent => {
  const payload = stringOrNull(row.payload)

  return {
    seq: numberOrNull(row.seq),
    ts: numberOrNull(row.ts),
    type: stringOr(row.type, "?"),
    outcome: stringOr(row.outcome, "?"),
    eventId: stringOrNull(row.event_id),
    payload,
    payloadParsed: parsePayloadObject(payload),
    preview: previewOf(row.payload),
  }
}

/** Narrow one connection-table row into a `DebugConnectionError`. */
export const toDebugConnectionError = (row: Record<string, unknown>): DebugConnectionError => ({
  seq: numberOrNull(row.seq),
  ts: numberOrNull(row.ts),
  type: stringOr(row.type, "?"),
  status: stringOr(row.status, "?"),
  detail: stringOrNull(row.detail),
})

/**
 * Open a reader, run one query, and always close — the shared shape behind
 * every diagnostic lookup. Returns the rows or the reader's `Error`.
 */
export const queryRows = (
  reader: ConnectorDiagnosticSqlReader,
  sql: string,
  params: (string | number | null)[],
): Record<string, unknown>[] | Error => {
  try {
    return reader.query(sql, params)
  } finally {
    reader.close()
  }
}
