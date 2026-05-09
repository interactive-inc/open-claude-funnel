import { useEffect, useState } from "react"
import { z } from "zod"
import type { Session, Snapshot } from "@/tui/types"
import type { Funnel } from "@/funnel"

const POLL_INTERVAL_MS = 3000

const sessionSchema = z.object({
  channel: z.string(),
  connectors: z.array(z.string()),
})

const statusResponseSchema = z.object({
  clients: z.array(sessionSchema),
})

const emptySnapshot: Snapshot = {
  connectors: [],
  channels: [],
  profiles: [],
  gateway: { running: false, pid: null, port: 9742 },
  listeners: [],
  sessions: [],
  daemonReachable: false,
  refreshedAt: 0,
}

const fetchSessions = async (
  port: number,
  daemonRunning: boolean,
  token: string | null,
): Promise<Session[]> => {
  if (!daemonRunning) return []

  try {
    const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {}
    const response = await fetch(`http://localhost:${port}/status`, { headers })

    if (!response.ok) return []

    const parsed = statusResponseSchema.safeParse(await response.json())

    if (!parsed.success) return []

    return parsed.data.clients.filter((client) => client.channel !== "*tap*")
  } catch {
    return []
  }
}

/**
 * Polls Funnel state every few seconds. The returned `refresh` callback forces
 * an immediate refetch — used by the manual `r` key and by listener-action
 * keystrokes that change daemon state.
 */
export const useSnapshot = (funnel: Funnel): { snapshot: Snapshot; refresh: () => void } => {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const gateway = funnel.gateway.getStatus()
      const token = funnel.gatewayToken.read()
      const [listenersResult, sessions] = await Promise.all([
        funnel.listeners.list(),
        fetchSessions(gateway.port, gateway.running, token),
      ])

      if (cancelled) return

      setSnapshot({
        connectors: funnel.channels.listAllConnectors(),
        channels: funnel.channels.list(),
        profiles: funnel.profiles.list(),
        gateway,
        listeners: listenersResult.state === "ok" ? listenersResult.listeners : [],
        sessions,
        daemonReachable: listenersResult.state === "ok",
        refreshedAt: Date.now(),
      })
    }

    void load()

    const timer = setInterval(() => void load(), POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [tick, funnel])

  return {
    snapshot,
    refresh: () => setTick((value) => value + 1),
  }
}
