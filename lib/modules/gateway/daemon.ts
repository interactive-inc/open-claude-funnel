#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { ServerWebSocket } from "bun"
import { Hono } from "hono"
import { logger } from "@/modules/logger"
import { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
import { createConnectorStores } from "@/modules/connectors/funnel-connector-stores"
import { migrateLegacyConnectors } from "@/modules/connectors/migrate-legacy-connectors"
import { FunnelBroadcaster } from "@/modules/gateway/funnel-broadcaster"
import { FunnelEventLogger } from "@/modules/gateway/funnel-event-logger"
import { killCompetingSlackGateways } from "@/modules/gateway/kill-competing-slack-gateways"
import { FUNNEL_DIR, FunnelSettingsStore } from "@/modules/settings/funnel-settings-store"

const PORT = Number(process.env.FUNNEL_PORT) || 9742
const PID_FILE = join(FUNNEL_DIR, "gateway.pid")
const LOG_DIR = "/tmp/funnel/events"

mkdirSync(FUNNEL_DIR, { recursive: true })

if (existsSync(PID_FILE)) {
  const existing = Number(readFileSync(PID_FILE, "utf-8").trim())

  if (existing > 0) {
    const check = Bun.spawnSync(["ps", "-p", String(existing), "-o", "state="], {
      stdout: "pipe",
      stderr: "pipe",
    })

    if (check.exitCode === 0 && check.stdout.toString().trim()) {
      logger.error(`funnel gateway already running`, { pid: existing })
      process.exit(1)
    }
  }
}

writeFileSync(PID_FILE, String(process.pid))

process.on("exit", () => {
  try {
    unlinkSync(PID_FILE)
  } catch {
    // ignore
  }
})
process.on("SIGINT", () => process.exit(130))
process.on("SIGTERM", () => process.exit(143))

const store = new FunnelSettingsStore()
const connectorStores = createConnectorStores()

migrateLegacyConnectors({ stores: connectorStores })

const channels: FunnelChannels = new FunnelChannels({
  store,
  connectorChecker: { has: (name: string) => connectors.has(name) },
})
const connectors: FunnelConnectors = new FunnelConnectors({
  ...connectorStores,
  refUpdater: channels,
})

const eventLogger = new FunnelEventLogger({ logDir: LOG_DIR })
const broadcaster = new FunnelBroadcaster()
const app = new Hono()

app.get("/health", (c) =>
  c.json({
    ok: true,
    pid: process.pid,
    clients: broadcaster.getClientCount(),
  }),
)

app.get("/status", (c) =>
  c.json({
    ok: true,
    clients: broadcaster.listChannels(),
  }),
)

const resolveConnectors = (channelName: string): string[] => {
  const settings = store.read()
  const channel = settings?.channels.find((c) => c.name === channelName)

  return channel?.connectors ?? []
}

type WsData = { channel: string; connectors: string[] }

Bun.serve<WsData>({
  port: PORT,
  fetch(request, server) {
    const url = new URL(request.url)

    if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") {
      const channelName = url.searchParams.get("channel") ?? ""
      const connectors = channelName ? resolveConnectors(channelName) : []
      const data: WsData = { channel: channelName, connectors }

      const upgraded = server.upgrade(request, { data })

      if (upgraded) return undefined

      return new Response("WebSocket upgrade failed", { status: 400 })
    }

    return app.fetch(request)
  },
  websocket: {
    open(ws: ServerWebSocket<WsData>) {
      const data = ws.data

      broadcaster.addClient(ws, data)

      eventLogger.log("channel connected", {
        event_type: "system",
        action: "channel_connect",
        channel: data.channel,
        connectors: data.connectors.join(","),
        total: String(broadcaster.getClientCount()),
      })
    },
    close(ws: ServerWebSocket<WsData>) {
      broadcaster.removeClient(ws)

      eventLogger.log("channel disconnected", {
        event_type: "system",
        action: "channel_disconnect",
        total: String(broadcaster.getClientCount()),
      })
    },
    message(_ws: ServerWebSocket<WsData>, _message: string | Buffer) {
      // Future: channel → gateway messages
    },
  },
})

eventLogger.log("gateway started", {
  event_type: "system",
  action: "gateway_start",
  port: String(PORT),
  pid: String(process.pid),
})

logger.info(`funnel gateway listening`, {
  url: `http://localhost:${PORT}`,
  websocket: `ws://localhost:${PORT}/ws`,
  health: `http://localhost:${PORT}/health`,
})

const notify = async (
  connectorName: string,
  content: string,
  meta?: Record<string, string>,
): Promise<void> => {
  const withConnector: Record<string, string> = { ...meta, connector: connectorName }

  eventLogger.log(content, withConnector)
  broadcaster.broadcast(content, withConnector)
}

const allConnectors = connectors.list()

// Multiple Slack Socket Mode connections sharing one App Token steal DMs/mentions
// from each other. Terminate other bun + gateway/bolt/slack processes first.
if (allConnectors.some((c) => c.type === "slack")) {
  const killed = await killCompetingSlackGateways({ selfPid: process.pid })

  if (killed.length > 0) {
    eventLogger.log("killed competing Slack gateway processes", {
      event_type: "system",
      action: "kill_competing",
      pids: killed.join(","),
    })
  }
}

for (const { config, listener } of connectors.createListeners()) {
  const bind = (content: string, meta?: Record<string, string>) =>
    notify(config.name, content, meta)

  try {
    await listener.start(bind)

    eventLogger.log(`${config.type} listener started: ${config.name}`, {
      event_type: "system",
      action: `${config.type}_connect`,
      connector: config.name,
    })

    logger.info(`${config.type} listener started`, { connector: config.name })
  } catch (error) {
    logger.error(`${config.type} listener failed`, {
      connector: config.name,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

logger.info(`event logs: ${LOG_DIR}`)
logger.info("funnel gateway running")
