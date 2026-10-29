import { requireIntegerLimit } from "@/require-limit"
import type { ConnectorQuery } from "@/engine/diagnostic-log/diagnostic-log"

/** Validate a stable view of scope and bounds before inspecting retained rows. */
export function snapshotDiagnosticQuery(query: ConnectorQuery): ConnectorQuery {
  const options: ConnectorQuery = {
    type: query.type,
    connectorId: query.connectorId,
    channelId: query.channelId,
    seq: query.seq,
    limit: query.limit,
  }
  if (options.seq !== undefined) requireIntegerLimit(options.seq, "seq")
  if (options.limit !== undefined) requireIntegerLimit(options.limit, "limit")
  return options
}
