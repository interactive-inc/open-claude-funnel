import type { Server, ServerWebSocket } from "bun";
import type { Hono } from "hono";
import type { FunnelConnectors } from "@/connectors/connectors";
import type { FunnelFileSystem } from "@/engine/fs/file-system";
import { constantTimeEqual, requireBearerToken } from "@/gateway/auth-middleware";
import { type Env, factory } from "@/gateway/factory";
import { FunnelBroadcaster } from "@/gateway/broadcaster";
import { FunnelEventLogger } from "@/gateway/event-logger";
import { JsonlReplaySource } from "@/gateway/jsonl-replay-source";
import { FunnelListenerSupervisor } from "@/gateway/listener-supervisor";
import { killCompetingSlackGateways } from "@/gateway/kill-competing-slack-gateways";
import { gatewayRoutes } from "@/gateway/routes/routes";
import { FunnelLogger } from "@/engine/logger/logger";
import { NodeFunnelLogger } from "@/engine/logger/node-logger";
import type { FunnelProcessRunner } from "@/engine/process/process-runner";
import type { FunnelSettingsReader } from "@/engine/settings/settings-reader";
import type { FunnelClock } from "@/engine/time/clock";

const DEFAULT_PORT = 9742;
const DEFAULT_LOG_DIR = "/tmp/funnel/events";

type Deps = {
  connectors: FunnelConnectors;
  settings: FunnelSettingsReader;
  port?: number;
  logDir?: string;
  fs?: FunnelFileSystem;
  process?: FunnelProcessRunner;
  clock?: FunnelClock;
  logger?: FunnelLogger;
  selfPid?: number;
  killCompetingSlack?: boolean;
  /** Bearer token required for `/listeners*`, `/status`, and `/ws`. Empty string disables auth (tests only). */
  token?: string;
};

type WsData = {
  channel: string;
  connectors: string[];
  tapAll?: boolean;
  /** Routing mode for this channel; resolved at upgrade time from settings. */
  delivery: "fanout" | "exclusive";
  /** Replay any events with offset strictly greater than this on open, then resume the live stream. */
  since?: number;
};

const defaultLogger = new NodeFunnelLogger();

/**
 * In-process gateway: runs `Bun.serve` (HTTP + WebSocket /ws), boots connector
 * listeners through `FunnelListenerSupervisor`, fans events out via
 * `FunnelBroadcaster`, and persists them via `FunnelEventLogger`. Exposes
 * `/listeners` HTTP for runtime start/stop/restart of individual connectors.
 */
export class FunnelGatewayServer {
  private readonly connectors: FunnelConnectors;
  private readonly settings: FunnelSettingsReader;
  private readonly port: number;
  private readonly logDir: string;
  private readonly fs?: FunnelFileSystem;
  private readonly process?: FunnelProcessRunner;
  private readonly logger: FunnelLogger;
  private readonly selfPid: number;
  private readonly killCompetingSlack: boolean;
  private readonly token: string;
  private readonly broadcaster: FunnelBroadcaster;
  private readonly eventLogger: FunnelEventLogger;
  private readonly supervisor: FunnelListenerSupervisor;
  private readonly nowMs: () => number;
  private startedAt: number | null = null;
  private server: Server<WsData> | null = null;

  constructor(deps: Deps) {
    this.connectors = deps.connectors;
    this.settings = deps.settings;
    this.port = deps.port ?? DEFAULT_PORT;
    this.logDir = deps.logDir ?? DEFAULT_LOG_DIR;
    this.fs = deps.fs;
    this.process = deps.process;
    this.logger = deps.logger ?? defaultLogger;
    this.selfPid = deps.selfPid ?? globalThis.process.pid;
    this.killCompetingSlack = deps.killCompetingSlack ?? true;
    this.token = deps.token ?? "";
    const clock = deps.clock;
    this.nowMs = clock ? () => clock.millis() : () => Date.now();
    const persistentReplay = new JsonlReplaySource({ logDir: this.logDir, fs: this.fs });
    this.broadcaster = new FunnelBroadcaster({
      logger: this.logger,
      now: this.nowMs,
      persistentReplay,
    });
    this.broadcaster.seedLatestOffset(persistentReplay.findMaxOffset());
    this.eventLogger = new FunnelEventLogger({
      logDir: this.logDir,
      fs: this.fs,
      now: this.nowMs,
    });
    this.supervisor = new FunnelListenerSupervisor({
      connectors: this.connectors,
      logger: this.logger,
      notify: (connectorName, content, meta) => this.notify(connectorName, content, meta),
      now: this.nowMs,
    });
  }

  async start(): Promise<Server<WsData>> {
    if (this.server) return this.server;

    const app = this.buildApp();

    this.startedAt = this.nowMs();
    this.server = Bun.serve<WsData>({
      port: this.port,
      development: false,
      fetch: (request, server) => this.handleFetch(request, server, app),
      websocket: {
        open: (ws) => this.handleWsOpen(ws),
        close: (ws) => this.handleWsClose(ws),
        message() {
          // required by Bun's websocket interface; no client → gateway messages today
        },
      },
    });

    this.logServerStarted();
    await this.bootListeners();

    return this.server;
  }

  async stop(): Promise<void> {
    await this.supervisor.stopAll();

    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  getStatus(): { clients: number; channels: { channel: string; connectors: string[] }[] } {
    return {
      clients: this.broadcaster.getClientCount(),
      channels: this.broadcaster.listChannels(),
    };
  }

  getBroadcaster(): FunnelBroadcaster {
    return this.broadcaster;
  }

  getSupervisor(): FunnelListenerSupervisor {
    return this.supervisor;
  }

  private handleFetch(
    request: Request,
    server: Server<WsData>,
    app: Hono<Env>,
  ): Response | Promise<Response> | undefined {
    const url = new URL(request.url);

    if (url.pathname === "/ws" && request.headers.get("upgrade") === "websocket") {
      if (this.token && !this.tokenMatchesUpgrade(request)) {
        return new Response("unauthorized", { status: 401 });
      }

      const tapAll = url.searchParams.get("tap") === "all";
      const channelName = tapAll ? "*tap*" : (url.searchParams.get("channel") ?? "");
      const channel = !tapAll && channelName ? this.resolveChannel(channelName) : null;
      const connectors = channel?.connectors ?? [];
      const delivery = channel?.delivery ?? "fanout";
      const sinceRaw = url.searchParams.get("since");
      const sinceParsed = sinceRaw === null ? Number.NaN : Number.parseInt(sinceRaw, 10);
      const since = Number.isFinite(sinceParsed) && sinceParsed >= 0 ? sinceParsed : undefined;
      const upgraded = server.upgrade(request, {
        data: { channel: channelName, connectors, tapAll, delivery, since },
      });

      if (upgraded) return undefined;

      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    return app.fetch(request);
  }

  private handleWsOpen(ws: ServerWebSocket<WsData>): void {
    if (typeof ws.data.since === "number") {
      const replay = this.broadcaster.replaySince(ws.data.since, ws.data);

      for (const event of replay) ws.send(JSON.stringify(event));
    }

    this.broadcaster.addClient(ws, ws.data);
    this.eventLogger.log("channel connected", {
      event_type: "system",
      action: "channel_connect",
      channel: ws.data.channel,
      connectors: ws.data.connectors.join(","),
      total: String(this.broadcaster.getClientCount()),
    });
  }

  private handleWsClose(ws: ServerWebSocket<WsData>): void {
    this.broadcaster.removeClient(ws);
    this.eventLogger.log("channel disconnected", {
      event_type: "system",
      action: "channel_disconnect",
      total: String(this.broadcaster.getClientCount()),
    });
  }

  private logServerStarted(): void {
    this.eventLogger.log("gateway started", {
      event_type: "system",
      action: "gateway_start",
      port: String(this.port),
      pid: String(this.selfPid),
    });

    this.logger.info("funnel gateway listening", {
      url: `http://localhost:${this.port}`,
      websocket: `ws://localhost:${this.port}/ws`,
      health: `http://localhost:${this.port}/health`,
    });
  }

  private buildApp(): Hono<Env> {
    const base = factory.createApp();

    base.use((c, next) => {
      c.set("deps", {
        selfPid: this.selfPid,
        broadcaster: this.broadcaster,
        supervisor: this.supervisor,
        uptimeMs: () => (this.startedAt ? this.nowMs() - this.startedAt : 0),
      });

      return next();
    });

    if (this.token) {
      base.use("/listeners/*", requireBearerToken({ expected: this.token }));
      base.use("/status", requireBearerToken({ expected: this.token }));
    }

    return base.route("/", gatewayRoutes);
  }

  /**
   * Reads the bearer token from the WebSocket upgrade request. Accepts:
   *   - `Sec-WebSocket-Protocol: funnel.token.<value>` (preferred — header, never logged in URLs)
   *   - `Authorization: Bearer <value>` (also header-based)
   * Returns true on a constant-time match against the daemon token.
   */
  private tokenMatchesUpgrade(request: Request): boolean {
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    for (const proto of protocols) {
      if (proto.startsWith("funnel.token.") && constantTimeEqual(proto.slice("funnel.token.".length), this.token)) {
        return true;
      }
    }

    const auth = request.headers.get("authorization") ?? "";
    const match = auth.match(/^Bearer\s+(.+)$/i);

    if (match && constantTimeEqual(match[1] ?? "", this.token)) return true;

    return false;
  }

  private resolveChannel(
    channelName: string,
  ): { connectors: string[]; delivery: "fanout" | "exclusive" } | null {
    const settings = this.settings.read();
    const channel = settings?.channels.find((c) => c.name === channelName);

    if (!channel) return null;

    return { connectors: channel.connectors, delivery: channel.delivery };
  }

  private async bootListeners(): Promise<void> {
    const allConnectors = this.connectors.list();

    if (this.killCompetingSlack && allConnectors.some((c) => c.type === "slack")) {
      const killed = await killCompetingSlackGateways({
        selfPid: this.selfPid,
        process: this.process,
        logger: this.logger,
      });

      if (killed.length > 0) {
        this.eventLogger.log("killed competing Slack gateway processes", {
          event_type: "system",
          action: "kill_competing",
          pids: killed.join(","),
        });
      }
    }

    await this.supervisor.startAll();

    for (const entry of this.supervisor.list()) {
      this.eventLogger.log(`${entry.type} listener started: ${entry.name}`, {
        event_type: "system",
        action: `${entry.type}_connect`,
        connector: entry.name,
      });
    }

    this.logger.info(`event logs: ${this.logDir}`);
    this.logger.info("funnel gateway running");
  }

  private async notify(
    connectorName: string,
    content: string,
    meta?: Record<string, string>,
  ): Promise<void> {
    const withConnector: Record<string, string> = { ...meta, connector: connectorName };
    const event = this.broadcaster.broadcast(content, withConnector);

    this.eventLogger.log(content, withConnector, event.offset);
  }
}
