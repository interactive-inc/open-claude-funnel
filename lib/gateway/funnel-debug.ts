import { existsSync } from "node:fs"
import { join } from "node:path"
import { ConnectorDiagnosticSqlReader } from "@/gateway/connector-diagnostic-sql-reader"
import type { FunnelGateway } from "@/gateway/gateway"
import type { FunnelChannels } from "@/engine/channels/channels"

type GatewayStatusResponse = {
  pid: number
  uptimeMs: number
  clients: {
    channel: string
    channelName: string | null
    connectors: string[]
  }[]
  listeners: {
    channelName: string
    name: string
    type: string
    alive: boolean
    events: number
    errors: number
    lastEventAt: string | null
  }[]
}

export type FunnelDebugReport = {
  gateway: {
    running: boolean
    pid: number | null
    port: number | null
    uptimeMs: number | null
  }
  channels: Array<{
    name: string
    connectors: string[]
    listener: { alive: boolean; events: number; errors: number; lastEventAt: string | null } | null
    claudeConnected: boolean
    claudeClientCount: number
  }>
  recentEvents: Array<{
    ts: number
    outcome: string
    payload: string | null
    preview: string | null
  }> | null
}

type Deps = {
  gateway: FunnelGateway
  channels: FunnelChannels
  tmpDir: string
}

const isGatewayStatusResponse = (value: unknown): value is GatewayStatusResponse => {
  if (value === null || typeof value !== "object") return false
  if (!("clients" in value) || !Array.isArray(value.clients)) return false
  if (!("listeners" in value) || !Array.isArray(value.listeners)) return false

  return true
}

export const buildFunnelDebugReport = async (
  deps: Deps,
  channelFilter: string | null,
): Promise<FunnelDebugReport> => {
  const gatewayStatus = deps.gateway.getStatus()

  const report: FunnelDebugReport = {
    gateway: {
      running: gatewayStatus.running,
      pid: gatewayStatus.pid,
      port: gatewayStatus.running ? gatewayStatus.port : null,
      uptimeMs: null,
    },
    channels: [],
    recentEvents: null,
  }

  const allChannels = deps.channels.list()
  const filteredChannels = channelFilter
    ? allChannels.filter((ch) => ch.name === channelFilter)
    : allChannels

  let gatewayData: GatewayStatusResponse | null = null

  if (gatewayStatus.running) {
    const res = await fetch(`http://127.0.0.1:${gatewayStatus.port}/status`).catch(() => null)

    if (res && res.ok) {
      const body: unknown = await res.json()

      if (isGatewayStatusResponse(body)) {
        gatewayData = body
        report.gateway.uptimeMs = body.uptimeMs
      }
    }
  }

  for (const ch of filteredChannels) {
    const listenerEntry = gatewayData?.listeners.find((l) => l.channelName === ch.name) ?? null

    const listener = listenerEntry
      ? {
          alive: listenerEntry.alive,
          events: listenerEntry.events,
          errors: listenerEntry.errors,
          lastEventAt: listenerEntry.lastEventAt,
        }
      : null

    const claudeClients = (gatewayData?.clients ?? []).filter(
      (cl) => cl.channelName === ch.name || cl.channel === ch.name,
    )

    report.channels.push({
      name: ch.name,
      connectors: ch.connectors.map((conn) => conn.name),
      listener,
      claudeConnected: claudeClients.length > 0,
      claudeClientCount: claudeClients.length,
    })
  }

  const rawPath = join(deps.tmpDir, "connector-raw.db")
  const processedPath = join(deps.tmpDir, "connector-processed.db")
  const connectionPath = join(deps.tmpDir, "connector-connection.db")

  if (existsSync(rawPath) && existsSync(processedPath) && existsSync(connectionPath)) {
    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const filteredChannelId = channelFilter
      ? (allChannels.find((ch) => ch.name === channelFilter)?.id ?? null)
      : null

    const sql = filteredChannelId
      ? "SELECT ts, outcome, payload FROM processed WHERE channel_id = ? ORDER BY seq DESC LIMIT 20"
      : "SELECT ts, outcome, payload FROM processed ORDER BY seq DESC LIMIT 20"

    const params = filteredChannelId ? [filteredChannelId] : []

    const rows = reader.query(sql, params)

    reader.close()

    if (!(rows instanceof Error)) {
      report.recentEvents = rows.map((row) => {
        const ts = typeof row.ts === "number" ? row.ts : 0
        const outcome = typeof row.outcome === "string" ? row.outcome : ""
        const payload = typeof row.payload === "string" ? row.payload : null
        const preview = payload ? payload.slice(0, 120) : null

        return { ts, outcome, payload, preview }
      })
    }
  }

  return report
}
