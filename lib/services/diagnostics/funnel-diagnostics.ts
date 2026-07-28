import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { gatewayLoopbackUrl } from "@/engine/http/gateway-base-url"
import { loopbackFetch } from "@/engine/http/loopback-fetch"
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
import { ConnectorDiagnosticSqlReader } from "@/engine/diagnostic-log/diagnostic-sql-reader"

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
    /**
     * Why the gateway /status probe failed to return a body. `null` when the
     * gateway is not running (running=false makes the absence self-explanatory)
     * or when the probe succeeded. A non-null value signals the daemon is up
     * but the probe failed (auth refused, fetch error, non-OK response).
     */
    statusError: string | null
  }
  /** Connectors declared in settings for this channel. */
  configuredConnectors: number
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

const FLAPPING_ERROR_THRESHOLD = 3

const buildDiagnosis = (
  report: Omit<ChannelDiagnosis, "diagnosis">,
): ChannelDiagnosis["diagnosis"] => {
  const latestError = report.connectionErrors[report.connectionErrors.length - 1] ?? null
  const rootCause = latestError?.detail ?? null
  const channel = report.channel

  if (!report.gateway.running) {
    return {
      status: "error",
      message: "gateway is not running",
      nextActions: ["fnl gateway start"],
      rootCause: null,
    }
  }

  // Daemon is up but the status probe failed — auth token mismatch or stale
  // process. The listener tables are empty under us, so flag this before
  // anything that depends on listener state to avoid misleading "no
  // connectors" or "all dead" diagnoses.
  if (report.gateway.statusError !== null) {
    return {
      status: "error",
      message: `gateway running but status probe failed: ${report.gateway.statusError}`,
      nextActions: ["fnl gateway restart"],
      rootCause: report.gateway.statusError,
    }
  }

  // Settings declare connectors but the supervisor has no listener for them
  // — a hot-reload race or a startup ordering bug. Distinct from "no
  // connectors configured" so the doctor knows to reconcile instead of asking
  // the operator to add one.
  if (report.configuredConnectors > report.listeners.length) {
    return {
      status: "error",
      message: `${report.configuredConnectors} connector(s) configured but ${report.listeners.length} registered with supervisor`,
      nextActions: ["fnl gateway restart"],
      rootCause: "supervisor missing listeners declared in settings.json",
    }
  }

  if (report.configuredConnectors === 0) {
    return {
      status: "warn",
      message: "no connectors configured on this channel",
      nextActions: [`fnl channels ${channel} connectors add <name> --type=slack ...`],
      rootCause: null,
    }
  }

  // Token rejected / Slack auth.test failed / GH token expired — all surface
  // here as 'auth-failed' rows. Surface them ahead of the generic "dead
  // listener" branch so the fix path can name the connector and credential.
  const authFailed = report.connectionErrors.filter((e) => e.status === "auth-failed")
  if (authFailed.length > 0) {
    const detail = authFailed[authFailed.length - 1]?.detail ?? null
    return {
      status: "error",
      message: "connector credentials rejected (auth-failed)",
      nextActions: [
        `fnl channels ${channel} connectors set <connector> --bot-token=<new>`,
        "fnl gateway restart",
      ],
      rootCause: detail ?? "token rejected by upstream auth.test",
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

  // Listener is alive but accumulating errors — supervisor is restart-looping
  // with backoff. Calling restart again would interrupt the backoff and make
  // it worse, so the doctor's safe mode skips it (see funnel-doctor.ts).
  const flapping = report.listeners.filter((l) => l.errors >= FLAPPING_ERROR_THRESHOLD)
  if (flapping.length > 0) {
    return {
      status: "warn",
      message: `listener(s) flapping (≥${FLAPPING_ERROR_THRESHOLD} errors): ${flapping.map((l) => l.name).join(", ")}`,
      nextActions: ["fnl gateway logs"],
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
    message:
      "Slack is only delivering app_mention events; unmentioned thread replies may not arrive",
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

    const gatewayProbe = await this.fetchGatewayStatus()
    const store = this.resolveStore()

    return this.buildChannelDiagnosis(target, gatewayProbe, store, 5)
  }

  async diagnoseAll(): Promise<DiagnoseAllReport> {
    const channels = this.props.channels.list()
    const gatewayProbe = await this.fetchGatewayStatus()
    const store = this.resolveStore()

    const reports = await Promise.all(
      channels.map((ch) => this.buildChannelDiagnosis(ch, gatewayProbe, store, 5)),
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

  async recentEvents(
    channelName: string | null,
    options: { connector?: string; limit?: number } = {},
  ): Promise<DiagnosticEvent[]> {
    const limit = options.limit ?? 20
    const ids = this.resolveScope(channelName, options.connector)

    if (ids === null) return []

    const reader = new ConnectorDiagnosticSqlReader(ids.store)
    const sql = `SELECT seq, ts, type, outcome, payload, event_id FROM processed ${ids.whereClause} ORDER BY seq DESC LIMIT ?`
    const rows = queryRows(reader, sql, [...ids.params, limit])

    if (rows instanceof Error) return []

    return rows.reverse().map(toDiagnosticEvent)
  }

  async droppedEvents(
    channelName: string | null,
    options: { connector?: string; limit?: number } = {},
  ): Promise<DiagnosticEvent[]> {
    const limit = options.limit ?? 20
    const ids = this.resolveScope(channelName, options.connector)

    if (ids === null) return []

    const where = ids.whereClause
      ? `${ids.whereClause} AND outcome LIKE 'skip:%'`
      : "WHERE outcome LIKE 'skip:%'"

    const reader = new ConnectorDiagnosticSqlReader(ids.store)
    const sql = `SELECT seq, ts, type, outcome, payload, event_id FROM processed ${where} ORDER BY seq DESC LIMIT ?`
    const rows = queryRows(reader, sql, [...ids.params, limit])

    if (rows instanceof Error) return []

    return rows.reverse().map(toDiagnosticEvent)
  }

  /**
   * Raw inbound rows the connector recorded before any processing. The most
   * useful read when "did the event even reach us?" is the question, since
   * the processed table never gets a row for an event the listener dropped
   * pre-processor.
   */
  async rawEvents(
    channelName: string | null,
    options: { connector?: string; limit?: number } = {},
  ): Promise<DiagnosticEvent[]> {
    const limit = options.limit ?? 20
    const ids = this.resolveScope(channelName, options.connector)

    if (ids === null) return []

    const reader = new ConnectorDiagnosticSqlReader(ids.store)
    // raw rows have no `outcome`; default it so toDiagnosticEvent stays uniform.
    const sql = `SELECT seq, ts, type, '' AS outcome, payload, event_id FROM raw ${ids.whereClause} ORDER BY seq DESC LIMIT ?`
    const rows = queryRows(reader, sql, [...ids.params, limit])

    if (rows instanceof Error) return []

    return rows.reverse().map(toDiagnosticEvent)
  }

  async connectionErrors(
    channelName: string | null,
    options: { connector?: string; limit?: number } = {},
  ): Promise<DiagnosticConnectionError[]> {
    const limit = options.limit ?? 20
    const ids = this.resolveScope(channelName, options.connector)

    if (ids === null) return []

    const where = ids.whereClause
      ? `${ids.whereClause} AND status IN ('auth-failed','error')`
      : "WHERE status IN ('auth-failed','error')"

    const reader = new ConnectorDiagnosticSqlReader(ids.store)
    const sql = `SELECT seq, ts, type, status, detail FROM connection ${where} ORDER BY seq DESC LIMIT ?`
    const rows = queryRows(reader, sql, [...ids.params, limit])

    if (rows instanceof Error) return []

    return rows.reverse().map(toDiagnosticConnectionError)
  }

  /**
   * Full connection lifecycle for one channel/connector — started, connected,
   * disconnected, stopped, plus the auth-failed / error rows that
   * `connectionErrors()` already surfaces. Use when you need to see the shape
   * of a flap (connected → reconnecting → connected → disconnected) instead
   * of just the failures.
   */
  async connectionTimeline(
    channelName: string | null,
    options: { connector?: string; limit?: number } = {},
  ): Promise<DiagnosticConnectionError[]> {
    const limit = options.limit ?? 20
    const ids = this.resolveScope(channelName, options.connector)

    if (ids === null) return []

    const reader = new ConnectorDiagnosticSqlReader(ids.store)
    const sql = `SELECT seq, ts, type, status, detail FROM connection ${ids.whereClause} ORDER BY seq DESC LIMIT ?`
    const rows = queryRows(reader, sql, [...ids.params, limit])

    if (rows instanceof Error) return []

    return rows.reverse().map(toDiagnosticConnectionError)
  }

  /**
   * Tail of `~/.funnel/.../funnel.log`. Use when a flume internal log (e.g.
   * `slack/auth.test failed`) needs to be read from MCP — the gateway file
   * sink is the only place that captures structured FunnelLogger output.
   *
   * `grep` is a case-insensitive substring filter applied after read so all
   * matching levels and sources are scanned.
   */
  async recentLogs(
    options: { grep?: string; limit?: number } = {},
  ): Promise<{ lines: string[]; path: string | null; truncated: boolean }> {
    const limit = options.limit ?? 200
    const path = join(this.props.tmpDir, "funnel.log")

    if (!existsSync(path)) return { lines: [], path: null, truncated: false }

    let content: string
    try {
      content = readFileSync(path, "utf-8")
    } catch (error) {
      return {
        lines: [`(read failed: ${errorMessageOf(error)})`],
        path,
        truncated: false,
      }
    }

    const all = content.split("\n").filter((line) => line.length > 0)
    const needle = options.grep?.toLowerCase()
    const filtered = needle ? all.filter((line) => line.toLowerCase().includes(needle)) : all

    const truncated = filtered.length > limit
    const lines = truncated ? filtered.slice(filtered.length - limit) : filtered

    return { lines, path, truncated }
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

  /**
   * Resolves a (channel, connector) filter into the SQL where-clause + the
   * positional params, or returns `null` when the requested scope cannot be
   * resolved (channel not found, connector not found in that channel, no
   * store on disk yet). Centralises the channel/connector → id mapping so
   * each read method does not redo the lookup.
   */
  private resolveScope(
    channelName: string | null,
    connectorName: string | undefined,
  ): { store: StorePaths; whereClause: string; params: (string | number)[] } | null {
    const store = this.resolveStore()
    if (!store) return null

    if (!channelName) {
      // No channel implies no connector filter either — connector names are
      // only unique within a channel.
      return { store, whereClause: "", params: [] }
    }

    const channels = this.props.channels.list()
    const channel = channels.find((ch) => ch.name === channelName) ?? null
    if (!channel) return null

    if (!connectorName) {
      return {
        store,
        whereClause: "WHERE channel_id = ?",
        params: [channel.id],
      }
    }

    const connectorId = channel.connectors?.find((c) => c.name === connectorName)?.id ?? null
    if (!connectorId) return null

    return {
      store,
      whereClause: "WHERE channel_id = ? AND connector_id = ?",
      params: [channel.id, connectorId],
    }
  }

  private async fetchGatewayStatus(): Promise<{
    body: GatewayStatusResponse | null
    error: string | null
  }> {
    const gatewayStatus = this.props.gateway.getStatus()
    if (!gatewayStatus.running) return { body: null, error: null }

    const token = this.props.gatewayToken.read()
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}

    let res: Response | null = null
    try {
      res = await loopbackFetch(`${gatewayLoopbackUrl(gatewayStatus.port)}/status`, { headers })
    } catch (error) {
      return { body: null, error: `fetch failed: ${errorMessageOf(error)}` }
    }

    if (!res.ok) return { body: null, error: `gateway /status returned ${res.status}` }

    let body: unknown
    try {
      body = await res.json()
    } catch (error) {
      return { body: null, error: `gateway /status body parse failed: ${errorMessageOf(error)}` }
    }

    if (!isGatewayStatusResponse(body)) {
      return { body: null, error: "gateway /status returned an unrecognized shape" }
    }

    return { body, error: null }
  }

  private async buildChannelDiagnosis(
    target: ChannelConfig,
    gatewayProbe: { body: GatewayStatusResponse | null; error: string | null },
    store: StorePaths | null,
    eventLimit: number,
  ): Promise<ChannelDiagnosis> {
    const gatewayStatus = this.props.gateway.getStatus()
    const targetName = target.name
    const gatewayBody = gatewayProbe.body

    const baseReport: Omit<ChannelDiagnosis, "diagnosis"> = {
      channel: targetName,
      channelId: target.id,
      gateway: {
        running: gatewayStatus.running,
        pid: gatewayStatus.pid,
        port: gatewayStatus.running ? gatewayStatus.port : null,
        uptimeMs: gatewayBody?.uptimeMs ?? null,
        statusError: gatewayProbe.error,
      },
      configuredConnectors: target.connectors?.length ?? 0,
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

      // Load auth-failed / error rows unconditionally: a listener that auth-
      // fails and the supervisor never restarted still shows as alive=false
      // here, but a listener that auth-failed during a token rotation while
      // some events succeed earlier will show alive=true with errors=0 — and
      // the diagnosis still needs to surface the auth-failed signal.
      const errRows = queryRows(
        new ConnectorDiagnosticSqlReader(store),
        "SELECT ts, type, status, detail FROM connection WHERE channel_id = ? AND status IN ('auth-failed','error') ORDER BY seq DESC LIMIT 3",
        [target.id],
      )

      if (!(errRows instanceof Error)) {
        baseReport.connectionErrors = errRows.reverse().map(toDiagnosticConnectionError)
      }
    }

    return { ...baseReport, diagnosis: buildDiagnosis(baseReport) }
  }
}
