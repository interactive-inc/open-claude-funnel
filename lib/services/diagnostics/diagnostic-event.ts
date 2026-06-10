import type { ConnectorDiagnosticSqlReader } from "@/engine/diagnostic-log/diagnostic-sql-reader"

export type DiagnosticEvent = {
  seq: number | null
  ts: number | null
  type: string
  outcome: string
  eventId: string | null
  payload: string | null
  payloadParsed: Record<string, unknown> | null
  preview: string | null
}

export type DiagnosticConnectionError = {
  seq: number | null
  ts: number | null
  type: string
  status: string
  detail: string | null
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null

const numberOrNull = (value: unknown): number | null => (typeof value === "number" ? value : null)

const stringOr = (value: unknown, fallback: string): string =>
  typeof value === "string" ? value : fallback

const isStringKeyedObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

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

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`

export const previewOf = (payload: unknown): string | null => {
  if (typeof payload !== "string" || payload.length === 0) return null

  const parsed = parsePayloadObject(payload)

  if (parsed !== null && "text" in parsed) {
    return truncate(String(parsed.text), 60)
  }

  return truncate(payload, 60)
}

export const toDiagnosticEvent = (row: Record<string, unknown>): DiagnosticEvent => {
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

export const toDiagnosticConnectionError = (
  row: Record<string, unknown>,
): DiagnosticConnectionError => ({
  seq: numberOrNull(row.seq),
  ts: numberOrNull(row.ts),
  type: stringOr(row.type, "?"),
  status: stringOr(row.status, "?"),
  detail: stringOrNull(row.detail),
})

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
