import type { Server, ServerWebSocket } from "bun"
import { Hono } from "hono"
import type { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
import type { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { FunnelBroadcaster } from "@/modules/gateway/funnel-broadcaster"
import { FunnelEventLogger } from "@/modules/gateway/funnel-event-logger"
import { killCompetingSlackGateways } from "@/modules/gateway/kill-competing-slack-gateways"
import { FunnelLogger } from "@/modules/logger/funnel-logger"
import { NodeFunnelLogger } from "@/modules/logger/node-funnel-logger"
import type { FunnelProcessRunner } from "@/modules/process/funnel-process-runner"
import type { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
import type { FunnelClock } from "@/modules/time/funnel-clock"

const DEFAULT_PORT = 9742
const DEFAULT_LOG_DIR = "/tmp/funnel/events"

type Deps = {
  connectors: FunnelConnectors
  settings: FunnelSettingsReader
  port?: number
  logDir?: string
  fs?: FunnelFileSystem
  process?: FunnelProcessRunner
  clock?: FunnelClock
  logger?: FunnelLogger
  selfPid?: number
  killCompetingSlack?: boolean
}

type WsData = { channel: string; connectors: string[] }

const defaultLogger = new NodeFunnelLogger()

/**
 * In-process gateway: runs `Bun.serve` (HTTP + WebSocket /ws), boots all
 * connector listeners, fans events out via FunnelBroadcaster, and persists
 * them via FunnelEventLogger. Useful for embedding the gateway in a custom
 * host or driving it from tests.
 */
export class FunnelGatewayServer {
  private readonly connectors: FunnelConnectors
  private readonly settings: FunnelSettingsReader
  private readonly port: number
  private readonly logDir: string
  private readonly fs?: FunnelFileSystem
  private readonly process?: FunnelProcessRunner
  private readonly logger: FunnelLogger
  private readonly selfPid: number
  private readonly killCompetingSlack: boolean
  private readonly broadcaster: FunnelBroadcaster
  private readonly eventLogger: FunnelEventLogger
  private server: Server<WsData> | null = null

  constructor(deps: Deps) {
    this.connectors = deps.connectors
    this.settings = deps.settings
    this.port = deps.port ?? DEFAULT_PORT
    this.logDir = deps.logDir ?? DEFAULT_LOG_DIR
    this.fs = deps.fs
    this.process = deps.process
    this.logger = deps.logger ?? defaultLogger
    this.selfPid = deps.selfPid ?? globalThis.process.pid
    this.killCompetingSlack = deps.killCompetingSlack ?? true
    this.broadcaster = new FunnelBroadcaster()
    this.eventLogger = new FunnelEventLogger({
      logDir: this.logDir,
      fs: this.fs,
      now: deps.clock ? () => deps.clock!.millis() : undefined,
    })
  }

  async start(): Promise<Server<WsData>> {
    if (this.server) return this.server

    const app = this.buildApp()

    this.server = Bun.serve<WsData>({
      port: this.port,
      fetch: (request, server) => {
        const url = new URL(request.url)

        if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") {
          const channelName = url.searchParams.get("channel") ?? ""
          const connectors = channelName ? this.resolveConnectors(channelName) : []
          const data: WsData = { channel: channelName, connectors }
          const upgraded = server.upgrade(request, { data })

          if (upgraded) return undefined

          return new Response("WebSocket upgrade failed", { status: 400 })
        }

        return app.fetch(request)
      },
      websocket: {
        open: (ws: ServerWebSocket<WsData>) => {
          const data = ws.data

          this.broadcaster.addClient(ws, data)
          this.eventLogger.log("channel connected", {
            event_type: "system",
            action: "channel_connect",
            channel: data.channel,
            connectors: data.connectors.join(","),
            total: String(this.broadcaster.getClientCount()),
          })
        },
        close: (ws: ServerWebSocket<WsData>) => {
          this.broadcaster.removeClient(ws)
          this.eventLogger.log("channel disconnected", {
            event_type: "system",
            action: "channel_disconnect",
            total: String(this.broadcaster.getClientCount()),
          })
        },
        message() {
          // future: client → gateway messages
        },
      },
    })

    this.eventLogger.log("gateway started", {
      event_type: "system",
      action: "gateway_start",
      port: String(this.port),
      pid: String(this.selfPid),
    })

    this.logger.info("funnel gateway listening", {
      url: `http://localhost:${this.port}`,
      websocket: `ws://localhost:${this.port}/ws`,
      health: `http://localhost:${this.port}/health`,
    })

    await this.bootListeners()

    return this.server
  }

  stop(): void {
    if (!this.server) return

    this.server.stop()
    this.server = null
  }

  getStatus(): { clients: number; channels: { channel: string; connectors: string[] }[] } {
    return {
      clients: this.broadcaster.getClientCount(),
      channels: this.broadcaster.listChannels(),
    }
  }

  getBroadcaster(): FunnelBroadcaster {
    return this.broadcaster
  }

  private buildApp(): Hono {
    const app = new Hono()

    app.get("/health", (c) =>
      c.json({
        ok: true,
        pid: this.selfPid,
        clients: this.broadcaster.getClientCount(),
      }),
    )

    app.get("/status", (c) =>
      c.json({
        ok: true,
        clients: this.broadcaster.listChannels(),
      }),
    )

    return app
  }

  private resolveConnectors(channelName: string): string[] {
    const settings = this.settings.read()
    const channel = settings?.channels.find((c) => c.name === channelName)

    return channel?.connectors ?? []
  }

  private async bootListeners(): Promise<void> {
    const allConnectors = this.connectors.list()

    if (this.killCompetingSlack && allConnectors.some((c) => c.type === "slack")) {
      const killed = await killCompetingSlackGateways({
        selfPid: this.selfPid,
        process: this.process,
        logger: this.logger,
      })

      if (killed.length > 0) {
        this.eventLogger.log("killed competing Slack gateway processes", {
          event_type: "system",
          action: "kill_competing",
          pids: killed.join(","),
        })
      }
    }

    for (const { config, listener } of this.connectors.createListeners()) {
      const bind = (content: string, meta?: Record<string, string>) =>
        this.notify(config.name, content, meta)

      try {
        await listener.start(bind)

        this.eventLogger.log(`${config.type} listener started: ${config.name}`, {
          event_type: "system",
          action: `${config.type}_connect`,
          connector: config.name,
        })

        this.logger.info(`${config.type} listener started`, { connector: config.name })
      } catch (error) {
        this.logger.error(`${config.type} listener failed`, {
          connector: config.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    this.logger.info(`event logs: ${this.logDir}`)
    this.logger.info("funnel gateway running")
  }

  private async notify(
    connectorName: string,
    content: string,
    meta?: Record<string, string>,
  ): Promise<void> {
    const withConnector: Record<string, string> = { ...meta, connector: connectorName }

    this.eventLogger.log(content, withConnector)
    this.broadcaster.broadcast(content, withConnector)
  }
}
