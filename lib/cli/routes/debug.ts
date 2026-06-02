import { existsSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { ConnectorDiagnosticSqlReader } from "@/gateway/connector-diagnostic-sql-reader"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"

export const debugHelp = `funnel debug — diagnose why Claude is not receiving events

usage: funnel debug [subcommand] [--channel <name>] [--all] [--json]

subcommands:
  (none)                full diagnosis (gateway + listener + Claude + last 5 events)
  events                last N processed events with outcome and preview
  dropped               events filtered out (skip:*) with payload detail
  errors                listener connection errors (auth-failed, error)

options:
  --channel <name>      channel to inspect (auto-selected when only one exists)
  --all                 diagnose all channels at once (JSON output)
  --limit <N>           number of recent events to include (default: 5; events/dropped/errors default: 20)
  --json                output as JSON (machine-readable, useful for Claude)

when a listener is dead the diagnosis includes rootCause — the most recent
connection error detail pulled from the connection log automatically.

use --json when asking Claude to analyse the output — it returns structured
data that Claude can parse without guessing at text formatting.

examples:
  funnel debug
  funnel debug --all --json
  funnel debug --channel open-karte
  funnel debug --channel open-karte --json
  funnel debug events --channel open-karte --limit 50
  funnel debug dropped --channel open-karte --json
  funnel debug errors`
const debugEventsHelp = `funnel debug events — last N processed events with outcome and preview

usage: funnel debug events [--channel <name>] [--limit <N>] [--json]

options:
  --channel <name>      channel to inspect (auto-selected when only one exists)
  --limit <N>           number of rows (default: 20)
  --json                output as JSON

examples:
  funnel debug events
  funnel debug events --channel open-karte --limit 50
  funnel debug events --json`
const debugDroppedHelp = `funnel debug dropped — events filtered out (skip:*)

usage: funnel debug dropped [--channel <name>] [--limit <N>] [--json]

options:
  --channel <name>      channel to inspect (auto-selected when only one exists)
  --limit <N>           number of rows (default: 20)
  --json                output as JSON

shows why events were skipped: skip:type, skip:subtype, skip:dedup,
skip:self-user, skip:self-bot, skip:preprocess

examples:
  funnel debug dropped
  funnel debug dropped --channel open-karte --json`
const debugErrorsHelp = `funnel debug errors — listener connection errors

usage: funnel debug errors [--channel <name>] [--limit <N>] [--json]

options:
  --channel <name>      channel to inspect (auto-selected when only one exists)
  --limit <N>           number of rows (default: 20)
  --json                output as JSON

shows auth-failed and error events from the connection lifecycle log.
use this when a listener never connects or keeps disconnecting.

examples:
  funnel debug errors
  funnel debug errors --channel open-karte`

type ListenerStatus = {
  channelName: string
  name: string
  type: string
  alive: boolean
  events: number
  errors: number
  lastEventAt: string | null
}

type ChannelClient = {
  channel: string
  channelName: string | null
  connectors: string[]
  tapAll: boolean | null
}

type GatewayStatusResponse = {
  pid: number
  uptimeMs: number
  clients: ChannelClient[]
  listeners: ListenerStatus[]
}

type ProcessedRow = {
  seq: unknown
  ts: unknown
  type: unknown
  outcome: unknown
  payload: unknown
}

type ConnectionError = {
  ts: number | null
  type: string
  status: string
  detail: string | null
}

type DebugReport = {
  channel: string
  gateway: {
    running: boolean
    pid: number | null
    port: number | null
    uptimeMs: number | null
  }
  listeners: Array<{
    name: string
    type: string
    alive: boolean
    events: number
    errors: number
    lastEventAt: string | null
  }>
  claudeClients: number
  channelId: string
  recentEvents: Array<{
    seq: number | null
    ts: number | null
    type: string
    outcome: string
    payload: string | null
    payloadParsed: Record<string, unknown> | null
    preview: string | null
  }>
  connectionErrors: ConnectionError[]
  diagnosis: {
    status: "ok" | "warn" | "error"
    message: string
    nextActions: string[]
    rootCause: string | null
  }
}

const isGatewayStatusResponse = (value: unknown): value is GatewayStatusResponse => {
  if (value === null || typeof value !== "object") return false
  if (!("clients" in value) || !Array.isArray(value.clients)) return false
  if (!("listeners" in value) || !Array.isArray(value.listeners)) return false

  return true
}

const formatUptime = (ms: number): string => {
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)

  if (min >= 60) return `${Math.floor(min / 60)}h ${min % 60}m`
  if (sec >= 60) return `${min}m ${sec % 60}s`

  return `${sec}s`
}

const formatTs = (epochMs: unknown): string => {
  if (typeof epochMs !== "number") return "?"

  return new Date(epochMs).toISOString().slice(11, 19)
}

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max)}…`

const extractPreview = (payload: unknown): string | null => {
  if (typeof payload !== "string" || payload.length === 0) return null

  try {
    const parsed = JSON.parse(payload) as unknown

    if (parsed !== null && typeof parsed === "object" && "text" in parsed) {
      return truncate(String((parsed as Record<string, unknown>).text), 60)
    }
  } catch {
    return truncate(payload, 60)
  }

  return truncate(payload, 60)
}

const buildDiagnosis = (
  report: Omit<DebugReport, "diagnosis">,
): DebugReport["diagnosis"] => {
  const latestError = report.connectionErrors[report.connectionErrors.length - 1] ?? null
  const rootCause = latestError?.detail ?? null

  if (!report.gateway.running) {
    return {
      status: "error",
      message: "gateway is not running",
      nextActions: ["fnl gateway start"],
      rootCause: null,
    }
  }

  const channel = report.channel
  const hasConnectors = report.listeners.length > 0

  if (!hasConnectors) {
    return {
      status: "warn",
      message: "no connectors configured on this channel",
      nextActions: [`fnl channels ${channel} connectors add <name> --type=slack ...`],
      rootCause: null,
    }
  }

  const allDead = report.listeners.every((l) => !l.alive)
  const someDead = report.listeners.some((l) => !l.alive)

  if (allDead) {
    return {
      status: "error",
      message: "all listeners are dead",
      nextActions: ["fnl gateway logs", "fnl gateway restart"],
      rootCause,
    }
  }

  if (someDead) {
    return {
      status: "warn",
      message: "some listeners are dead",
      nextActions: ["fnl gateway logs"],
      rootCause,
    }
  }

  const hasErrors = report.listeners.some((l) => l.errors > 0)

  if (report.claudeClients === 0) {
    return {
      status: "warn",
      message: "no Claude connected to this channel",
      nextActions: [`fnl claude --channel ${channel}`],
      rootCause: null,
    }
  }

  if (hasErrors) {
    return {
      status: "warn",
      message: "listeners have errors",
      nextActions: ["fnl gateway logs"],
      rootCause,
    }
  }

  return {
    status: "ok",
    message: "everything looks healthy",
    nextActions: [],
    rootCause: null,
  }
}

const renderText = (report: DebugReport): string => {
  const lines: string[] = []

  lines.push(`= funnel debug: ${report.channel} =`)
  lines.push("")

  const gw = report.gateway

  if (!gw.running) {
    lines.push("[gateway]    ○ not running")
  } else {
    const uptime = gw.uptimeMs !== null ? ` · up ${formatUptime(gw.uptimeMs)}` : ""

    lines.push(`[gateway]    ● running  pid ${gw.pid} · port ${gw.port}${uptime}`)
  }

  if (report.listeners.length === 0) {
    lines.push("[listener]   - no listener")
  } else {
    for (const listener of report.listeners) {
      const indicator = listener.alive ? "●" : "○"
      const state = listener.alive ? "alive " : "dead  "
      const eventsStr = `${listener.events} events`
      const lastStr = listener.lastEventAt ? ` · last ${listener.lastEventAt.slice(11, 19)}` : ""
      const errStr = listener.errors > 0 ? ` · ⚠ ${listener.errors} errors` : ""

      lines.push(`[listener]   ${indicator} ${state} ${eventsStr}${lastStr}${errStr}`)
    }
  }

  const claudeCount = report.claudeClients

  if (claudeCount === 0) {
    lines.push("[claude]     ○ not connected")
  } else {
    lines.push(`[claude]     ● connected (${claudeCount} WS client${claudeCount > 1 ? "s" : ""})`)
  }

  if (report.recentEvents.length === 0) {
    lines.push("[events]     no events recorded")
  } else {
    lines.push(`[events]     last ${report.recentEvents.length} event${report.recentEvents.length > 1 ? "s" : ""}:`)

    for (const event of report.recentEvents) {
      const time = formatTs(event.ts)
      const type = event.type.padEnd(8)
      const outcome = event.outcome.padEnd(20)
      const preview = event.preview ? ` "${event.preview}"` : ""
      const seq = event.seq !== null ? ` (seq=${event.seq})` : ""

      lines.push(`               ${time}  ${type} ${outcome}${preview}${seq}`)
    }
  }

  if (report.connectionErrors.length > 0) {
    lines.push("[conn errs]  recent connection errors:")

    for (const err of report.connectionErrors) {
      const time = formatTs(err.ts)
      const status = err.status.padEnd(14)
      const detail = err.detail ? ` "${err.detail}"` : ""

      lines.push(`               ${time}  ${err.type.padEnd(8)}  ${status}${detail}`)
    }
  }

  lines.push("")

  const diag = report.diagnosis
  const icon = diag.status === "ok" ? "✓" : diag.status === "warn" ? "⚠" : "✗"

  lines.push(`diagnosis: ${icon} ${diag.message}`)

  if (diag.rootCause) {
    lines.push(`  root cause: ${diag.rootCause}`)
  }

  for (const action of diag.nextActions) {
    lines.push(`  → ${action}`)
  }

  return lines.join("\n")
}

type EventRow = {
  seq: unknown
  ts: unknown
  type: unknown
  outcome: unknown
  payload: unknown
  event_id: unknown
}

type ConnectionRow = {
  seq: unknown
  ts: unknown
  type: unknown
  status: unknown
  detail: unknown
}

const resolveStoreOrNull = (): { rawPath: string; processedPath: string; connectionPath: string } | null => {
  const tmpDir = funnelTmpDir()
  const rawPath = join(tmpDir, "connector-raw.db")
  const processedPath = join(tmpDir, "connector-processed.db")
  const connectionPath = join(tmpDir, "connector-connection.db")

  if (!existsSync(rawPath) || !existsSync(processedPath) || !existsSync(connectionPath)) {
    return null
  }

  return { rawPath, processedPath, connectionPath }
}

type ResolvedChannel =
  | { found: true; channel: { id: string; name: string } }
  | { found: false; reason: "not-found"; name: string }
  | { found: false; reason: "ambiguous"; names: string[] }
  | { found: false; reason: "none" }

const resolveChannelId = (
  channels: { id: string; name: string }[],
  channelName: string | undefined,
): ResolvedChannel => {
  if (channelName) {
    const match = channels.find((ch) => ch.name === channelName)

    if (match) return { found: true, channel: match }

    return { found: false, reason: "not-found", name: channelName }
  }

  if (channels.length === 1 && channels[0]) return { found: true, channel: channels[0] }

  if (channels.length === 0) return { found: false, reason: "none" }

  return { found: false, reason: "ambiguous", names: channels.map((ch) => ch.name) }
}

export const debugEventsHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      channel: z.string().optional(),
      limit: z.string().optional(),
      json: z.enum(["true", "false", ""]).optional(),
    }),
    debugEventsHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const channels = funnel.channels.list()
    const isJson = query.json === "true" || query.json === ""
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 20

    const store = resolveStoreOrNull()

    if (!store) {
      if (isJson) return c.json([])

      return c.text("no diagnostic store yet (start the gateway first)")
    }

    const resolved = resolveChannelId(channels, query.channel)

    if (!resolved.found) {
      if (resolved.reason === "not-found") {
        if (isJson) return c.json({ error: `channel not found: ${resolved.name}`, availableChannels: channels.map((ch) => ch.name) })

        return c.text(`channel not found: ${resolved.name}`)
      }

      if (resolved.reason === "ambiguous") {
        if (isJson) return c.json({ error: "multiple channels — specify one with --channel", channels: resolved.names })

        return c.text(`multiple channels — specify one with --channel:\n${resolved.names.map((n) => `  - ${n}`).join("\n")}`)
      }

      if (isJson) return c.json([])

      return c.text("no channels configured")
    }

    const channel = resolved.channel

    const reader = new ConnectorDiagnosticSqlReader(store)

    const rows = (() => {
      try {
        if (channel) {
          return reader.query(
            "SELECT seq, ts, type, outcome, payload FROM processed WHERE channel_id = ? ORDER BY seq DESC LIMIT ?",
            [channel.id, limit],
          )
        }

        return reader.query(
          "SELECT seq, ts, type, outcome, payload FROM processed ORDER BY seq DESC LIMIT ?",
          [limit],
        )
      } finally {
        reader.close()
      }
    })()

    if (rows instanceof Error) return c.text(`error: ${rows.message}`)

    const events = ([...rows] as EventRow[]).reverse().map((row) => {
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

      return {
        seq: typeof row.seq === "number" ? row.seq : null,
        ts: typeof row.ts === "number" ? row.ts : null,
        type: typeof row.type === "string" ? row.type : "?",
        outcome: typeof row.outcome === "string" ? row.outcome : "?",
        payload: rawPayload,
        payloadParsed,
        preview: extractPreview(row.payload),
      }
    })

    if (isJson) return c.json(events)

    if (events.length === 0) return c.text("no events recorded")

    const lines = events.map((ev) => {
      const time = formatTs(ev.ts)
      const type = ev.type.padEnd(8)
      const outcome = ev.outcome.padEnd(20)
      const preview = ev.preview ? `  "${ev.preview}"` : ""
      const seq = ev.seq !== null ? `  seq=${ev.seq}` : ""

      return `${time}  ${type}  ${outcome}${seq}${preview}`
    })

    return c.text(lines.join("\n"))
  },
)

export const debugDroppedHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      channel: z.string().optional(),
      limit: z.string().optional(),
      json: z.enum(["true", "false", ""]).optional(),
    }),
    debugDroppedHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const channels = funnel.channels.list()
    const isJson = query.json === "true" || query.json === ""
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 20

    const store = resolveStoreOrNull()

    if (!store) {
      if (isJson) return c.json([])

      return c.text("no diagnostic store yet (start the gateway first)")
    }

    const resolvedDropped = resolveChannelId(channels, query.channel)

    if (!resolvedDropped.found) {
      if (resolvedDropped.reason === "not-found") {
        if (isJson) return c.json({ error: `channel not found: ${resolvedDropped.name}`, availableChannels: channels.map((ch) => ch.name) })

        return c.text(`channel not found: ${resolvedDropped.name}`)
      }

      if (resolvedDropped.reason === "ambiguous") {
        if (isJson) return c.json({ error: "multiple channels — specify one with --channel", channels: resolvedDropped.names })

        return c.text(`multiple channels — specify one with --channel:\n${resolvedDropped.names.map((n) => `  - ${n}`).join("\n")}`)
      }

      if (isJson) return c.json([])

      return c.text("no channels configured")
    }

    const channel = resolvedDropped.channel

    const reader = new ConnectorDiagnosticSqlReader(store)

    const rows = (() => {
      try {
        if (channel) {
          return reader.query(
            "SELECT p.seq, p.ts, p.type, p.outcome, p.payload, p.event_id FROM processed p WHERE p.channel_id = ? AND p.outcome LIKE 'skip:%' ORDER BY p.seq DESC LIMIT ?",
            [channel.id, limit],
          )
        }

        return reader.query(
          "SELECT seq, ts, type, outcome, payload, event_id FROM processed WHERE outcome LIKE 'skip:%' ORDER BY seq DESC LIMIT ?",
          [limit],
        )
      } finally {
        reader.close()
      }
    })()

    if (rows instanceof Error) return c.text(`error: ${rows.message}`)

    const events = ([...rows] as EventRow[]).reverse().map((row) => {
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

      return {
        seq: typeof row.seq === "number" ? row.seq : null,
        ts: typeof row.ts === "number" ? row.ts : null,
        type: typeof row.type === "string" ? row.type : "?",
        outcome: typeof row.outcome === "string" ? row.outcome : "?",
        event_id: typeof row.event_id === "string" ? row.event_id : null,
        payload: rawPayload,
        payloadParsed,
        preview: extractPreview(row.payload),
      }
    })

    if (isJson) return c.json(events)

    if (events.length === 0) return c.text("no dropped events recorded")

    const lines = events.map((ev) => {
      const time = formatTs(ev.ts)
      const type = ev.type.padEnd(8)
      const outcome = ev.outcome.padEnd(20)
      const seq = ev.seq !== null ? `  seq=${ev.seq}` : ""
      const eid = ev.event_id ? `  event_id=${ev.event_id.slice(0, 8)}` : ""
      const preview = ev.preview ? `  "${ev.preview}"` : ""

      return `${time}  ${type}  ${outcome}${seq}${eid}${preview}`
    })

    return c.text(lines.join("\n"))
  },
)

export const debugErrorsHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      channel: z.string().optional(),
      limit: z.string().optional(),
      json: z.enum(["true", "false", ""]).optional(),
    }),
    debugErrorsHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const channels = funnel.channels.list()
    const isJson = query.json === "true" || query.json === ""
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 20

    const store = resolveStoreOrNull()

    if (!store) {
      if (isJson) return c.json([])

      return c.text("no diagnostic store yet (start the gateway first)")
    }

    const resolvedErrors = resolveChannelId(channels, query.channel)

    if (!resolvedErrors.found) {
      if (resolvedErrors.reason === "not-found") {
        if (isJson) return c.json({ error: `channel not found: ${resolvedErrors.name}`, availableChannels: channels.map((ch) => ch.name) })

        return c.text(`channel not found: ${resolvedErrors.name}`)
      }

      if (resolvedErrors.reason === "ambiguous") {
        if (isJson) return c.json({ error: "multiple channels — specify one with --channel", channels: resolvedErrors.names })

        return c.text(`multiple channels — specify one with --channel:\n${resolvedErrors.names.map((n) => `  - ${n}`).join("\n")}`)
      }

      if (isJson) return c.json([])

      return c.text("no channels configured")
    }

    const channel = resolvedErrors.channel

    const reader = new ConnectorDiagnosticSqlReader(store)

    const rows = (() => {
      try {
        if (channel) {
          return reader.query(
            "SELECT seq, ts, type, status, detail FROM connection WHERE channel_id = ? AND status IN ('auth-failed','error') ORDER BY seq DESC LIMIT ?",
            [channel.id, limit],
          )
        }

        return reader.query(
          "SELECT seq, ts, type, status, detail FROM connection WHERE status IN ('auth-failed','error') ORDER BY seq DESC LIMIT ?",
          [limit],
        )
      } finally {
        reader.close()
      }
    })()

    if (rows instanceof Error) return c.text(`error: ${rows.message}`)

    const errors = ([...rows] as ConnectionRow[]).reverse().map((row) => ({
      seq: typeof row.seq === "number" ? row.seq : null,
      ts: typeof row.ts === "number" ? row.ts : null,
      type: typeof row.type === "string" ? row.type : "?",
      status: typeof row.status === "string" ? row.status : "?",
      detail: typeof row.detail === "string" && row.detail.length > 0 ? row.detail : null,
    }))

    if (isJson) return c.json(errors)

    if (errors.length === 0) return c.text("no connection errors recorded")

    const lines = errors.map((ev) => {
      const time = formatTs(ev.ts)
      const type = ev.type.padEnd(8)
      const status = ev.status.padEnd(16)
      const detail = ev.detail ? `  "${ev.detail}"` : ""

      return `${time}  ${type}  ${status}${detail}`
    })

    return c.text(lines.join("\n"))
  },
)

const buildChannelReport = async (
  targetChannel: { id: string; name: string },
  gatewayStatus: { running: boolean; pid: number | null; port: number },
  gatewayBodyOrNull: GatewayStatusResponse | null,
  store: { rawPath: string; processedPath: string; connectionPath: string } | null,
  limit: number = 5,
): Promise<DebugReport> => {
  const targetChannelName = targetChannel.name

  const baseReport: Omit<DebugReport, "diagnosis"> = {
    channel: targetChannelName,
    channelId: targetChannel.id,
    gateway: {
      running: gatewayStatus.running,
      pid: gatewayStatus.pid,
      port: gatewayStatus.running ? gatewayStatus.port : null,
      uptimeMs: gatewayBodyOrNull?.uptimeMs ?? null,
    },
    listeners: [],
    claudeClients: 0,
    recentEvents: [],
    connectionErrors: [],
  }

  if (gatewayBodyOrNull) {
    baseReport.listeners = gatewayBodyOrNull.listeners
      .filter((l) => l.channelName === targetChannelName)
      .map((l) => ({
        name: l.name,
        type: l.type,
        alive: l.alive,
        events: l.events,
        errors: l.errors,
        lastEventAt: l.lastEventAt,
      }))

    baseReport.claudeClients = gatewayBodyOrNull.clients.filter(
      (cl) => !cl.tapAll && cl.channelName === targetChannelName,
    ).length
  }

  if (store) {
    const reader = new ConnectorDiagnosticSqlReader(store)

    const evRows = (() => {
      try {
        return reader.query(
          "SELECT seq, ts, type, outcome, payload FROM processed WHERE channel_id = ? ORDER BY seq DESC LIMIT ?",
          [targetChannel.id, limit],
        )
      } finally {
        reader.close()
      }
    })()

    if (!(evRows instanceof Error)) {
      baseReport.recentEvents = (evRows as ProcessedRow[]).reverse().map((row) => {
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

        return {
          seq: typeof row.seq === "number" ? row.seq : null,
          ts: typeof row.ts === "number" ? row.ts : null,
          type: typeof row.type === "string" ? row.type : "?",
          outcome: typeof row.outcome === "string" ? row.outcome : "?",
          payload: rawPayload,
          payloadParsed,
          preview: extractPreview(row.payload),
        }
      })
    }

    const hasDeadListeners = baseReport.listeners.some((l) => !l.alive)
    const hasListenerErrors = baseReport.listeners.some((l) => l.errors > 0)

    if (hasDeadListeners || hasListenerErrors) {
      const errReader = new ConnectorDiagnosticSqlReader(store)

      const errRows = (() => {
        try {
          return errReader.query(
            "SELECT ts, type, status, detail FROM connection WHERE channel_id = ? AND status IN ('auth-failed','error') ORDER BY seq DESC LIMIT 3",
            [targetChannel.id],
          )
        } finally {
          errReader.close()
        }
      })()

      if (!(errRows instanceof Error)) {
        baseReport.connectionErrors = (errRows as ConnectionRow[]).reverse().map((row) => ({
          ts: typeof row.ts === "number" ? row.ts : null,
          type: typeof row.type === "string" ? row.type : "?",
          status: typeof row.status === "string" ? row.status : "?",
          detail: typeof row.detail === "string" && row.detail.length > 0 ? row.detail : null,
        }))
      }
    }
  }

  return { ...baseReport, diagnosis: buildDiagnosis(baseReport) }
}

export const debugHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      channel: z.string().optional(),
      all: z.enum(["true", "false", ""]).optional(),
      json: z.enum(["true", "false", ""]).optional(),
      limit: z.string().optional(),
    }),
    debugHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const channels = funnel.channels.list()
    const gatewayStatus = funnel.gateway.getStatus()
    const isJson = query.json === "true" || query.json === ""
    const isAll = query.all === "true" || query.all === ""
    const eventLimit = query.limit ? Math.max(1, Number(query.limit)) : 5

    if (channels.length === 0) {
      if (isJson) return c.json({ error: "no channels configured", nextAction: "fnl channels add <name>" })

      return c.text("no channels configured — run: fnl channels add <name>")
    }

    const token = funnel.gatewayToken.read()
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

    let gatewayBodyOrNull: GatewayStatusResponse | null = null

    if (gatewayStatus.running) {
      const res = await fetch(
        `http://127.0.0.1:${gatewayStatus.port}/status`,
        { headers },
      ).catch(() => null)

      if (res && res.ok) {
        const body: unknown = await res.json()

        if (isGatewayStatusResponse(body)) {
          gatewayBodyOrNull = body
        }
      }
    }

    const store = resolveStoreOrNull()

    if (isAll) {
      const reports = await Promise.all(
        channels.map((ch) => buildChannelReport(ch, gatewayStatus, gatewayBodyOrNull, store, eventLimit)),
      )

      const errorChannels = reports.filter((r) => r.diagnosis.status === "error").map((r) => r.channel)
      const warnChannels = reports.filter((r) => r.diagnosis.status === "warn").map((r) => r.channel)
      const okChannels = reports.filter((r) => r.diagnosis.status === "ok").map((r) => r.channel)
      const uniqueActions = [...new Set(reports.flatMap((r) => r.diagnosis.nextActions))]

      return c.json({
        summary: {
          total: reports.length,
          ok: okChannels.length,
          warn: warnChannels.length,
          error: errorChannels.length,
          criticalChannels: errorChannels,
          warnChannels,
          suggestedActions: uniqueActions,
        },
        channels: reports,
      })
    }

    let targetChannel: { id: string; name: string } | null = null

    if (query.channel) {
      targetChannel = channels.find((ch) => ch.name === query.channel) ?? null

      if (!targetChannel) {
        if (isJson) return c.json({ error: `channel not found: ${query.channel}`, availableChannels: channels.map((ch) => ch.name) })

        return c.text(`channel not found: ${query.channel}`)
      }
    } else if (channels.length === 1 && channels[0]) {
      targetChannel = channels[0]
    } else {
      const names = channels.map((ch) => ch.name)

      if (isJson) {
        return c.json({
          error: "multiple channels — specify one with --channel or use --all",
          channels: names,
          hint: "use --all for all channels at once",
        })
      }

      return c.text(`multiple channels — specify one with --channel or use --all:\n${names.map((n) => `  - ${n}`).join("\n")}`)
    }

    const report = await buildChannelReport(targetChannel, gatewayStatus, gatewayBodyOrNull, store, eventLimit)

    if (isJson) {
      return c.json(report)
    }

    return c.text(renderText(report))
  },
)

const debugReplayHelp = `funnel debug replay — re-publish a past event into a channel

usage: funnel debug replay --channel <name> [--seq <N>] [--json]

options:
  --channel <name>   channel to replay into (required when multiple channels exist)
  --seq <N>          replay the event at this processed-table seq (default: most recent emitted)
  --json             output result as JSON

Re-sends a past event from the diagnostic store through the publisher path,
so subscribers receive it again. Useful to verify that Claude handles an event
correctly without waiting for a real external trigger.

Gateway must be running. The event is injected via POST /channels/<name>/publish.

examples:
  fnl debug replay --channel open-karte
  fnl debug replay --channel open-karte --seq 412
  fnl debug replay --channel open-karte --json`

type RawRow = {
  event_id: unknown
  payload: unknown
}

type ProcessedSeqRow = {
  seq: unknown
  event_id: unknown
  type: unknown
  payload: unknown
  connector_id: unknown
  channel_id: unknown
}

export const debugReplayHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      channel: z.string().optional(),
      seq: z.string().optional(),
      json: z.enum(["true", "false", ""]).optional(),
    }),
    debugReplayHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const channels = funnel.channels.list()
    const isJson = query.json === "true" || query.json === ""

    const resolved = resolveChannelId(channels, query.channel)

    if (!resolved.found) {
      if (resolved.reason === "not-found") {
        if (isJson) return c.json({ error: `channel not found: ${resolved.name}`, availableChannels: channels.map((ch) => ch.name) })

        return c.text(`channel not found: ${resolved.name}`)
      }

      if (resolved.reason === "ambiguous") {
        if (isJson) return c.json({ error: "multiple channels — specify one with --channel", channels: resolved.names })

        return c.text(`multiple channels — specify one with --channel:\n${resolved.names.map((n) => `  - ${n}`).join("\n")}`)
      }

      if (isJson) return c.json({ error: "no channels configured" })

      return c.text("no channels configured")
    }

    const targetChannel = resolved.channel

    const store = resolveStoreOrNull()

    if (!store) {
      if (isJson) return c.json({ error: "no diagnostic store yet (start the gateway first)" })

      return c.text("no diagnostic store yet (start the gateway first)")
    }

    const reader = new ConnectorDiagnosticSqlReader(store)

    const rows = (() => {
      try {
        if (query.seq) {
          return reader.query(
            "SELECT seq, event_id, type, payload, connector_id, channel_id FROM processed WHERE channel_id = ? AND seq = ? LIMIT 1",
            [targetChannel.id, Number(query.seq)],
          )
        }

        return reader.query(
          "SELECT seq, event_id, type, payload, connector_id, channel_id FROM processed WHERE channel_id = ? AND outcome LIKE 'emitted%' ORDER BY seq DESC LIMIT 1",
          [targetChannel.id],
        )
      } finally {
        reader.close()
      }
    })()

    if (rows instanceof Error) {
      if (isJson) return c.json({ error: rows.message })

      return c.text(`error: ${rows.message}`)
    }

    const firstRow = rows[0] as ProcessedSeqRow | undefined

    if (!firstRow) {
      if (isJson) return c.json({ error: "no matching event found" })

      return c.text("no matching event found")
    }

    const seq = typeof firstRow.seq === "number" ? firstRow.seq : null
    const eventId = typeof firstRow.event_id === "string" ? firstRow.event_id : null
    const connectorId = typeof firstRow.connector_id === "string" ? firstRow.connector_id : null

    let content = typeof firstRow.payload === "string" ? firstRow.payload : null

    if ((!content || content.length === 0) && eventId) {
      const rawReader = new ConnectorDiagnosticSqlReader(store)

      const rawRows = (() => {
        try {
          return rawReader.query(
            "SELECT payload FROM raw WHERE event_id = ? LIMIT 1",
            [eventId],
          )
        } finally {
          rawReader.close()
        }
      })()

      if (!(rawRows instanceof Error) && rawRows[0]) {
        const rawRow = rawRows[0] as RawRow

        content = typeof rawRow.payload === "string" ? rawRow.payload : null
      }
    }

    if (!content) {
      if (isJson) return c.json({ error: "event has no payload to replay" })

      return c.text("event has no payload to replay")
    }

    const connectorName = connectorId
      ? (targetChannel as unknown as { connectors?: { id: string; name: string }[] }).connectors?.find((c) => c.id === connectorId)?.name
      : undefined

    const result = await funnel.publisher.publish(targetChannel.name, {
      content,
      connector: connectorName,
    })

    if (result.state === "offline") {
      if (isJson) return c.json({ error: "gateway daemon is not running", nextAction: "fnl gateway start" })

      return c.text("error: gateway daemon is not running — run: fnl gateway start")
    }

    if (result.state === "error") {
      if (isJson) return c.json({ error: result.reason })

      return c.text(`error: ${result.reason}`)
    }

    const preview = extractPreview(content)

    if (isJson) {
      return c.json({ replayed: true, seq, offset: result.offset, preview })
    }

    return c.text(`replayed seq=${seq ?? "?"} → offset=${result.offset}${preview ? `  "${preview}"` : ""}`)
  },
)
