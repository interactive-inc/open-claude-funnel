import { factory } from "@/gateway/factory"
import {
  diagnosticConnectionEventOf,
  diagnosticEventOfProcessed,
} from "@/engine/diagnostic-log/diagnostic-event"

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
  subscribers: number
  recentEvents: RecentEvent[]
  connectionErrors: ConnectionError[]
  diagnosis: {
    status: "ok" | "warn" | "error"
    message: string
    nextActions: string[]
    rootCause: string | null
  }
}

const buildChannelDiagnosis = (
  channel: Omit<ChannelDebug, "diagnosis">,
): ChannelDebug["diagnosis"] => {
  const latestError = channel.connectionErrors[channel.connectionErrors.length - 1] ?? null
  const rootCause = latestError?.detail ?? null

  if (channel.connectors.length > 0 && !channel.listener) {
    return {
      status: "error",
      message: "no listener running for this channel",
      nextActions: ["restart the listener through the host"],
      rootCause,
    }
  }

  if (channel.listener && !channel.listener.alive) {
    return {
      status: "error",
      message: "listener is dead",
      nextActions: ["inspect connection logs", "restart the listener through the host"],
      rootCause,
    }
  }

  if (channel.subscribers === 0) {
    return {
      status: "warn",
      message: "no subscribers connected to this channel",
      nextActions: ["connect a channel subscriber"],
      rootCause: null,
    }
  }

  if (channel.listener && channel.listener.errors > 0) {
    return {
      status: "warn",
      message: "listener has errors",
      nextActions: ["inspect connection logs"],
      rootCause,
    }
  }

  return { status: "ok", message: "healthy", nextActions: [], rootCause: null }
}

/** GET /debug[?channel=<name>] — per-channel diagnosis with recent events. */
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

    const subscribers = gatewayClients.filter(
      (cl) => cl.channel === ch.id || cl.channel === ch.name,
    ).length

    const recentEvents: RecentEvent[] = (() => {
      if (!deps.diagnosticLog) return []

      try {
        return deps.diagnosticLog
          .queryProcessed({ channelId: ch.id, limit: 10 })
          .map(diagnosticEventOfProcessed)
      } catch {
        return []
      }
    })()

    const needsConnErrors = (listener && (!listener.alive || listener.errors > 0)) || !listener
    const connectionErrors: ConnectionError[] = (() => {
      if (!needsConnErrors || !deps.diagnosticLog) return []

      try {
        return deps.diagnosticLog
          .queryConnection({
            channelId: ch.id,
            statuses: ["auth-failed", "error"],
            limit: 3,
          })
          .map(diagnosticConnectionEventOf)
      } catch {
        return []
      }
    })()

    const base = {
      id: ch.id,
      name: ch.name,
      connectors: ch.connectors.map((conn) => conn.name),
      listener,
      subscribers,
      recentEvents,
      connectionErrors,
    }

    return { ...base, diagnosis: buildChannelDiagnosis(base) }
  })

  return c.json({
    uptimeMs: deps.uptimeMs(),
    eventsBroadcast: metrics.eventsBroadcast,
    channels,
  })
})
