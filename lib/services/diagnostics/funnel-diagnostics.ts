import { existsSync } from "node:fs"
import { join } from "node:path"
import type { ChannelConfig } from "@/engine/settings/settings-schema"
import type {
  DiagnosticConnectionError,
  DiagnosticEvent,
} from "@/services/diagnostics/diagnostic-event"
import {
  queryRows,
  toDiagnosticConnectionError,
  toDiagnosticEvent,
} from "@/services/diagnostics/diagnostic-event"
import { ConnectorDiagnosticSqlReader } from "@/gateway/diagnostic-log/diagnostic-sql-reader"

/** Narrow channel registry — only `list()` is needed. */
export type DiagnosticsChannelSource = {
  list(): ChannelConfig[]
}

/** Narrow gateway probe — only the daemon status is needed. */
export type DiagnosticsGatewayProbe = {
  getStatus(): { running: boolean; pid: number | null; port: number }
}

/** Narrow token reader — diagnostics only needs to read the token, never to mint or rotate it. */
export type DiagnosticsTokenReader = {
  read(): string | null
}

/** Narrow publisher used only for replay. */
export type DiagnosticsPublisher = {
  publish(
    channelName: string,
    request: { content: string; connector?: string },
  ): Promise<
    { state: "ok"; offset: number } | { state: "offline" } | { state: "error"; reason: string }
  >
}

type Props = {
  gateway: DiagnosticsGatewayProbe
  gatewayToken: DiagnosticsTokenReader
  channels: DiagnosticsChannelSource
  publisher: DiagnosticsPublisher
  tmpDir: string
}

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
}

type GatewayStatusResponse = {
  pid: number
  uptimeMs: number
  clients: ChannelClient[]
  listeners: ListenerStatus[]
}

export type DiagnosisStatus = "ok" | "warn" | "error"

export type ChannelDiagnosis = {
  channel: string
  channelId: string
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
  recentEvents: DiagnosticEvent[]
  connectionErrors: DiagnosticConnectionError[]
  diagnosis: {
    status: DiagnosisStatus
    message: string
    nextActions: string[]
    rootCause: string | null
  }
}

export type DiagnoseAllReport = {
  summary: {
    total: number
    ok: number
    warn: number
    error: number
    criticalChannels: string[]
    warnChannels: string[]
    suggestedActions: string[]
  }
  channels: ChannelDiagnosis[]
}

export type ReplayResult =
  | { state: "ok"; seq: number | null; offset: number; preview: string | null }
  | { state: "offline" }
  | { state: "error"; reason: string }
  | { state: "not-found" }

const isGatewayStatusResponse = (value: unknown): value is GatewayStatusResponse => {
  if (value === null || typeof value !== "object") return false
  if (!("clients" in value) || !Array.isArray(value.clients)) return false
  if (!("listeners" in value) || !Array.isArray(value.listeners)) return false

  return true
}

const connectorOf = (channel: ChannelConfig, connectorId: string | null): string | undefined => {
  if (connectorId === null) return undefined

  return channel.connectors?.find((connector) => connector.id === connectorId)?.name
}

const buildDiagnosis = (
  report: Omit<ChannelDiagnosis, "diagnosis">,
): ChannelDiagnosis["diagnosis"] => {
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
      nextActions: ["fnl doctor --fix", "fnl doctor --fix --aggressive"],
      rootCause,
    }
  }

  if (someDead) {
    return {
      status: "warn",
      message: "some listeners are dead",
      nextActions: ["fnl doctor --fix"],
      rootCause,
    }
  }

  if (report.claudeClients === 0) {
    return {
      status: "warn",
      message: "no Claude connected to this channel",
      nextActions: [`fnl claude --channel ${channel}`],
      rootCause: null,
    }
  }

  const hasErrors = report.listeners.some((l) => l.errors > 0)

  if (hasErrors) {
    return {
      status: "warn",
      message: "listeners have errors",
      nextActions: ["fnl gateway logs"],
      rootCause,
    }
  }

  const slackEventGap = diagnoseSlackEventSubscriptionGap(report)

  if (slackEventGap !== null) {
    return slackEventGap
  }

  return {
    status: "ok",
    message: "everything looks healthy",
    nextActions: [],
    rootCause: null,
  }
}

const diagnoseSlackEventSubscriptionGap = (
  report: Omit<ChannelDiagnosis, "diagnosis">,
): ChannelDiagnosis["diagnosis"] | null => {
  const hasSlackListener = report.listeners.some((listener) => listener.type === "slack")

  if (!hasSlackListener || report.recentEvents.length === 0) return null

  const slackEvents = report.recentEvents
    .filter((event) => event.type === "slack")
    .map((event) => event.payloadParsed?.type)

  if (slackEvents.length === 0) return null

  const sawAppMention = slackEvents.includes("app_mention")
  const sawMessage = slackEvents.includes("message")

  if (!sawAppMention || sawMessage) return null

  return {
    status: "warn",
    message: "Slack is only delivering app_mention events; unmentioned thread replies may not arrive",
    nextActions: [
      "Add Slack bot events: message.channels, message.groups, message.im, message.mpim; reinstall the app; then restart the gateway",
    ],
    rootCause: "Slack Event Subscriptions likely omit message.* events",
  }
}

type StorePaths = { rawPath: string; processedPath: string; connectionPath: string }

/**
 * Programmable diagnostics surface — used by both the CLI (fnl debug …) and
 * the MCP tools (fnl_debug, fnl_recent_events, …). Pure read-side, no
 * mutation; pair with FunnelRecovery for self-healing actions.
 */
export class FunnelDiagnostics {
  constructor(private readonly props: Props) {
    Object.freeze(this)
  }

  async diagnose(channelName?: string): Promise<ChannelDiagnosis | null> {
    const channels = this.props.channels.list()
    const target = channelName
      ? (channels.find((ch) => ch.name === channelName) ?? null)
      : (channels[0] ?? null)

    if (!target) return null

    const gatewayBody = await this.fetchGatewayStatus()
    const store = this.resolveStore()

    return this.buildChannelDiagnosis(target, gatewayBody, store, 5)
  }

  async diagnoseAll(): Promise<DiagnoseAllReport> {
    const channels = this.props.channels.list()
    const gatewayBody = await this.fetchGatewayStatus()
    const store = this.resolveStore()

    const reports = await Promise.all(
      channels.map((ch) => this.buildChannelDiagnosis(ch, gatewayBody, store, 5)),
    )

    const errorChannels = reports
      .filter((r) => r.diagnosis.status === "error")
      .map((r) => r.channel)
    const warnChannels = reports.filter((r) => r.diagnosis.status === "warn").map((r) => r.channel)
    const okChannels = reports.filter((r) => r.diagnosis.status === "ok").map((r) => r.channel)
    const uniqueActions = [...new Set(reports.flatMap((r) => r.diagnosis.nextActions))]

    return {
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
    }
  }

  async recentEvents(channelName: string | null, limit: number = 20): Promise<DiagnosticEvent[]> {
    const store = this.resolveStore()

    if (!store) return []

    const channelId = this.resolveChannelId(channelName)

    if (channelName && !channelId) return []

    const reader = new ConnectorDiagnosticSqlReader(store)
    const rows = channelId
      ? queryRows(
          reader,
          "SELECT seq, ts, type, outcome, payload FROM processed WHERE channel_id = ? ORDER BY seq DESC LIMIT ?",
          [channelId, limit],
        )
      : queryRows(
          reader,
          "SELECT seq, ts, type, outcome, payload FROM processed ORDER BY seq DESC LIMIT ?",
          [limit],
        )

    if (rows instanceof Error) return []

    return rows.reverse().map(toDiagnosticEvent)
  }

  async droppedEvents(channelName: string | null, limit: number = 20): Promise<DiagnosticEvent[]> {
    const store = this.resolveStore()

    if (!store) return []

    const channelId = this.resolveChannelId(channelName)

    if (channelName && !channelId) return []

    const reader = new ConnectorDiagnosticSqlReader(store)
    const rows = channelId
      ? queryRows(
          reader,
          "SELECT seq, ts, type, outcome, payload, event_id FROM processed WHERE channel_id = ? AND outcome LIKE 'skip:%' ORDER BY seq DESC LIMIT ?",
          [channelId, limit],
        )
      : queryRows(
          reader,
          "SELECT seq, ts, type, outcome, payload, event_id FROM processed WHERE outcome LIKE 'skip:%' ORDER BY seq DESC LIMIT ?",
          [limit],
        )

    if (rows instanceof Error) return []

    return rows.reverse().map(toDiagnosticEvent)
  }

  async connectionErrors(
    channelName: string | null,
    limit: number = 20,
  ): Promise<DiagnosticConnectionError[]> {
    const store = this.resolveStore()

    if (!store) return []

    const channelId = this.resolveChannelId(channelName)

    if (channelName && !channelId) return []

    const reader = new ConnectorDiagnosticSqlReader(store)
    const rows = channelId
      ? queryRows(
          reader,
          "SELECT seq, ts, type, status, detail FROM connection WHERE channel_id = ? AND status IN ('auth-failed','error') ORDER BY seq DESC LIMIT ?",
          [channelId, limit],
        )
      : queryRows(
          reader,
          "SELECT seq, ts, type, status, detail FROM connection WHERE status IN ('auth-failed','error') ORDER BY seq DESC LIMIT ?",
          [limit],
        )

    if (rows instanceof Error) return []

    return rows.reverse().map(toDiagnosticConnectionError)
  }

  async replay(channelName: string, seq?: number): Promise<ReplayResult> {
    const channels = this.props.channels.list()
    const channel = channels.find((ch) => ch.name === channelName)

    if (!channel) return { state: "not-found" }

    const store = this.resolveStore()

    if (!store) return { state: "error", reason: "no diagnostic store yet" }

    const reader = new ConnectorDiagnosticSqlReader(store)
    const rows =
      seq !== undefined
        ? queryRows(
            reader,
            "SELECT seq, event_id, type, payload, connector_id, channel_id FROM processed WHERE channel_id = ? AND seq = ? LIMIT 1",
            [channel.id, seq],
          )
        : queryRows(
            reader,
            "SELECT seq, event_id, type, payload, connector_id, channel_id FROM processed WHERE channel_id = ? AND outcome LIKE 'emitted%' ORDER BY seq DESC LIMIT 1",
            [channel.id],
          )

    if (rows instanceof Error) return { state: "error", reason: rows.message }

    const firstRow = rows[0]

    if (!firstRow) return { state: "not-found" }

    const replaySeq = typeof firstRow.seq === "number" ? firstRow.seq : null
    const eventId = typeof firstRow.event_id === "string" ? firstRow.event_id : null
    const connectorId = typeof firstRow.connector_id === "string" ? firstRow.connector_id : null

    let content = typeof firstRow.payload === "string" ? firstRow.payload : null

    if ((!content || content.length === 0) && eventId) {
      const rawRows = queryRows(
        new ConnectorDiagnosticSqlReader(store),
        "SELECT payload FROM raw WHERE event_id = ? LIMIT 1",
        [eventId],
      )

      const rawRow = rawRows instanceof Error ? null : rawRows[0]

      if (rawRow) {
        content = typeof rawRow.payload === "string" ? rawRow.payload : null
      }
    }

    if (!content) return { state: "error", reason: "event has no payload to replay" }

    const connectorName = connectorOf(channel, connectorId)
    const result = await this.props.publisher.publish(channel.name, {
      content,
      connector: connectorName,
    })

    if (result.state === "offline") return { state: "offline" }
    if (result.state === "error") return { state: "error", reason: result.reason }

    return {
      state: "ok",
      seq: replaySeq,
      offset: result.offset,
      preview: content.slice(0, 60),
    }
  }

  resolveStore(): StorePaths | null {
    const tmpDir = this.props.tmpDir
    const rawPath = join(tmpDir, "connector-raw.db")
    const processedPath = join(tmpDir, "connector-processed.db")
    const connectionPath = join(tmpDir, "connector-connection.db")

    if (!existsSync(rawPath) || !existsSync(processedPath) || !existsSync(connectionPath)) {
      return null
    }

    return { rawPath, processedPath, connectionPath }
  }

  private resolveChannelId(channelName: string | null): string | null {
    if (!channelName) return null
    const channels = this.props.channels.list()
    return channels.find((ch) => ch.name === channelName)?.id ?? null
  }

  private async fetchGatewayStatus(): Promise<GatewayStatusResponse | null> {
    const gatewayStatus = this.props.gateway.getStatus()
    if (!gatewayStatus.running) return null

    const token = this.props.gatewayToken.read()
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

    const res = await fetch(`http://127.0.0.1:${gatewayStatus.port}/status`, { headers }).catch(
      () => null,
    )

    if (!res || !res.ok) return null

    const body: unknown = await res.json()

    return isGatewayStatusResponse(body) ? body : null
  }

  private async buildChannelDiagnosis(
    target: { id: string; name: string },
    gatewayBody: GatewayStatusResponse | null,
    store: StorePaths | null,
    eventLimit: number,
  ): Promise<ChannelDiagnosis> {
    const gatewayStatus = this.props.gateway.getStatus()
    const targetName = target.name

    const baseReport: Omit<ChannelDiagnosis, "diagnosis"> = {
      channel: targetName,
      channelId: target.id,
      gateway: {
        running: gatewayStatus.running,
        pid: gatewayStatus.pid,
        port: gatewayStatus.running ? gatewayStatus.port : null,
        uptimeMs: gatewayBody?.uptimeMs ?? null,
      },
      listeners: [],
      claudeClients: 0,
      recentEvents: [],
      connectionErrors: [],
    }

    if (gatewayBody) {
      baseReport.listeners = gatewayBody.listeners
        .filter((l) => l.channelName === targetName)
        .map((l) => ({
          name: l.name,
          type: l.type,
          alive: l.alive,
          events: l.events,
          errors: l.errors,
          lastEventAt: l.lastEventAt,
        }))

      baseReport.claudeClients = gatewayBody.clients.filter(
        (cl) => cl.channelName === targetName,
      ).length
    }

    if (store) {
      const evRows = queryRows(
        new ConnectorDiagnosticSqlReader(store),
        "SELECT seq, ts, type, outcome, payload FROM processed WHERE channel_id = ? ORDER BY seq DESC LIMIT ?",
        [target.id, eventLimit],
      )

      if (!(evRows instanceof Error)) {
        baseReport.recentEvents = evRows.reverse().map(toDiagnosticEvent)
      }

      const hasDeadListeners = baseReport.listeners.some((l) => !l.alive)
      const hasListenerErrors = baseReport.listeners.some((l) => l.errors > 0)

      if (hasDeadListeners || hasListenerErrors) {
        const errRows = queryRows(
          new ConnectorDiagnosticSqlReader(store),
          "SELECT ts, type, status, detail FROM connection WHERE channel_id = ? AND status IN ('auth-failed','error') ORDER BY seq DESC LIMIT 3",
          [target.id],
        )

        if (!(errRows instanceof Error)) {
          baseReport.connectionErrors = errRows.reverse().map(toDiagnosticConnectionError)
        }
      }
    }

    return { ...baseReport, diagnosis: buildDiagnosis(baseReport) }
  }
}
