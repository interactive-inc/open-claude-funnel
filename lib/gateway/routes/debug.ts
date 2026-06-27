import { existsSync } from "node:fs"
import { join } from "node:path"
import { factory } from "@/gateway/factory"
import { ConnectorDiagnosticSqlReader } from "@/engine/diagnostic-log/diagnostic-sql-reader"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"

type RecentEvent = {
  seq: number | null
  ts: number | null
  type: string
  outcome: string
  payload: string | null
  payloadParsed: Record<string, unknown> | null
  preview: string | null
}

type ConnectionError = {
  ts: number | null
  type: string
  status: string
  detail: string | null
}

type ChannelDebug = {
  id: string
  name: string
  connectors: string[]
  listener: { alive: boolean; events: number; errors: number; lastEventAt: string | null } | null
  claudeClients: number
  recentEvents: RecentEvent[]
  connectionErrors: ConnectionError[]
  diagnosis: {
    status: "ok" | "warn" | "error"
    message: string
    nextActions: string[]
    rootCause: string | null
  }
}

const extractPreview = (payload: unknown): string | null => {
  if (typeof payload !== "string" || payload.length === 0) return null

  try {
    const parsed = JSON.parse(payload) as unknown

    if (parsed !== null && typeof parsed === "object" && "text" in parsed) {
      const text = String((parsed as Record<string, unknown>).text)

      return text.length > 80 ? `${text.slice(0, 80)}…` : text
    }
  } catch {
    return payload.length > 80 ? `${payload.slice(0, 80)}…` : payload
  }

  return payload.length > 80 ? `${payload.slice(0, 80)}…` : payload
}

const buildChannelDiagnosis = (
  channel: Omit<ChannelDebug, "diagnosis">,
): ChannelDebug["diagnosis"] => {
  const latestError = channel.connectionErrors[channel.connectionErrors.length - 1] ?? null
  const rootCause = latestError?.detail ?? null

  if (channel.connectors.length === 0) {
    return {
      status: "warn",
      message: "no connectors configured on this channel",
      nextActions: [`fnl channels ${channel.name} connectors add <name> --type=slack ...`],
      rootCause: null,
    }
  }

  if (!channel.listener) {
    return {
      status: "error",
      message: "no listener running for this channel",
      nextActions: ["fnl gateway restart"],
      rootCause,
    }
  }

  if (!channel.listener.alive) {
    return {
      status: "error",
      message: "listener is dead",
      nextActions: ["fnl gateway logs", "fnl gateway restart"],
      rootCause,
    }
  }

  if (channel.claudeClients === 0) {
    return {
      status: "warn",
      message: "no Claude connected to this channel",
      nextActions: [`fnl claude --channel ${channel.name}`],
      rootCause: null,
    }
  }

  if (channel.listener.errors > 0) {
    return {
      status: "warn",
      message: "listener has errors",
      nextActions: ["fnl gateway logs"],
      rootCause,
    }
  }

  return { status: "ok", message: "healthy", nextActions: [], rootCause: null }
}

/** GET /debug[?channel=<name>] — per-channel diagnosis with recent events. Used by MCP fnl_debug tool. */
export const debugHandler = factory.createHandlers(async (c) => {
  const deps = c.var.deps
  const channelFilter = c.req.query("channel") ?? null

  const allChannels = deps.channels.list()
  const targetChannels = channelFilter
    ? allChannels.filter((ch) => ch.name === channelFilter || ch.id === channelFilter)
    : allChannels

  const gatewayListeners = deps.registry.list()
  const gatewayClients = deps.broadcaster.listChannels()
  const metrics = deps.broadcaster.getMetrics()

  const tmpDir = funnelTmpDir()
  const rawPath = join(tmpDir, "connector-raw.db")
  const processedPath = join(tmpDir, "connector-processed.db")
  const connectionPath = join(tmpDir, "connector-connection.db")

  const hasStore = existsSync(rawPath) && existsSync(processedPath) && existsSync(connectionPath)

  const channels: ChannelDebug[] = targetChannels.map((ch) => {
    const listenerEntry = gatewayListeners.find((l) => l.channelName === ch.name) ?? null

    const listener = listenerEntry
      ? {
          alive: listenerEntry.alive,
          events: listenerEntry.events,
          errors: listenerEntry.errors,
          lastEventAt: listenerEntry.lastEventAt,
        }
      : null

    const claudeClients = gatewayClients.filter(
      (cl) => cl.channel === ch.id || cl.channel === ch.name,
    ).length

    const recentEvents: RecentEvent[] = []
    const connectionErrors: ConnectionError[] = []

    if (hasStore) {
      const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

      const rows = (() => {
        try {
          return reader.query(
            "SELECT seq, ts, type, outcome, payload FROM processed WHERE channel_id = ? ORDER BY seq DESC LIMIT 10",
            [ch.id],
          )
        } finally {
          reader.close()
        }
      })()

      if (!(rows instanceof Error)) {
        for (const row of [...rows].reverse()) {
          const rawPayload = typeof row.payload === "string" ? row.payload : null
          let payloadParsed: Record<string, unknown> | null = null

          if (rawPayload) {
            try {
              const parsed = JSON.parse(rawPayload) as unknown

              if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
                payloadParsed = parsed as Record<string, unknown>
              }
            } catch {
              payloadParsed = null
            }
          }

          recentEvents.push({
            seq: typeof row.seq === "number" ? row.seq : null,
            ts: typeof row.ts === "number" ? row.ts : null,
            type: typeof row.type === "string" ? row.type : "?",
            outcome: typeof row.outcome === "string" ? row.outcome : "?",
            payload: rawPayload,
            payloadParsed,
            preview: extractPreview(row.payload),
          })
        }
      }

      const needsConnErrors = (listener && (!listener.alive || listener.errors > 0)) || !listener

      if (needsConnErrors) {
        const errReader = new ConnectorDiagnosticSqlReader({
          rawPath,
          processedPath,
          connectionPath,
        })

        const errRows = (() => {
          try {
            return errReader.query(
              "SELECT ts, type, status, detail FROM connection WHERE channel_id = ? AND status IN ('auth-failed','error') ORDER BY seq DESC LIMIT 3",
              [ch.id],
            )
          } finally {
            errReader.close()
          }
        })()

        if (!(errRows instanceof Error)) {
          for (const row of [...errRows].reverse()) {
            connectionErrors.push({
              ts: typeof row.ts === "number" ? row.ts : null,
              type: typeof row.type === "string" ? row.type : "?",
              status: typeof row.status === "string" ? row.status : "?",
              detail: typeof row.detail === "string" && row.detail.length > 0 ? row.detail : null,
            })
          }
        }
      }
    }

    const base = {
      id: ch.id,
      name: ch.name,
      connectors: ch.connectors.map((conn) => conn.name),
      listener,
      claudeClients,
      recentEvents,
      connectionErrors,
    }

    return { ...base, diagnosis: buildChannelDiagnosis(base) }
  })

  return c.json({
    pid: deps.selfPid,
    uptimeMs: deps.uptimeMs(),
    eventsBroadcast: metrics.eventsBroadcast,
    channels,
  })
})
