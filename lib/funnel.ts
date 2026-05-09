import { join } from "node:path"
import { FunnelConnectorFactory } from "@/connectors/connector-factory"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelClaude } from "@/engine/claude/claude"
import type { FunnelFileSystem } from "@/engine/fs/file-system"
import type { FunnelIdGenerator } from "@/engine/id/id-generator"
import { FunnelLogger } from "@/engine/logger/logger"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { FunnelMcp } from "@/engine/mcp/mcp"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FunnelProfiles } from "@/engine/profiles/profiles"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { FUNNEL_DIR, FunnelSettingsStore } from "@/engine/settings/settings-store"
import type { FunnelClock } from "@/engine/time/clock"
import { FunnelGateway } from "@/gateway/gateway"
import { FunnelGatewayServer } from "@/gateway/gateway-server"
import { FunnelGatewayToken } from "@/gateway/gateway-token"
import { FunnelListenersClient } from "@/gateway/listeners-client"

type Props = {
  /** Settings persistence (channels with nested connectors / profiles). Defaults to a FunnelSettingsStore rooted at `dir`. */
  store?: FunnelSettingsReader
  /** Filesystem boundary. Replace with MemoryFunnelFileSystem to sandbox all disk I/O. */
  fs?: FunnelFileSystem
  /** Process runner used by gateway / claude / gh listener. Replace with MemoryFunnelProcessRunner for tests. */
  process?: FunnelProcessRunner
  /** Logger flowed into every facet. Replace with MemoryFunnelLogger or NoopFunnelLogger to silence/inspect. */
  logger?: FunnelLogger
  /** Clock used by schedule listener, gh poll watermarks, and gateway timeouts. */
  clock?: FunnelClock
  /** ID generator for channel and connector ids. Use MemoryFunnelIdGenerator for deterministic tests. */
  idGenerator?: FunnelIdGenerator
  /** Funnel home directory (settings.json + per-channel/per-connector dirs). Defaults to ~/.funnel. */
  dir?: string
  /** Temp / runtime directory (gateway logs and PID adjacent files). Defaults to /tmp/funnel. */
  tmpDir?: string
}

/**
 * Facade exposing every funnel facet as a getter.
 *
 * The same `Funnel` is used by the CLI, the TUI, and as a programmable library.
 * All side-effecting boundaries (filesystem, process, logger, clock, id, paths) are
 * injectable via `Props` — passing memory implementations gives a fully sandboxed
 * Funnel that touches no real disk, processes, or wall-clock time.
 *
 * Connectors live nested inside their owning channel (channels[].connectors[]),
 * so connector CRUD is reached via `funnel.channels.addConnector(...)` etc.
 *
 * @example
 * ```ts
 * const funnel = new Funnel({})
 * const channel = funnel.channels.add({ name: "inbox" })
 * funnel.channels.addConnector("inbox", { type: "slack", name: "ops", botToken, appToken })
 * await funnel.gatewayServer({ port: 9742 }).start()
 * ```
 */
export class Funnel {
  constructor(private readonly props: Props = {}) {
    Object.freeze(this)
  }

  /** Settings reader. If not injected, a FunnelSettingsStore rooted at `dir` is created. */
  get store(): FunnelSettingsReader {
    return (
      this.props.store ??
      new FunnelSettingsStore({
        path: join(this.props.dir ?? FUNNEL_DIR, "settings.json"),
        fs: this.props.fs,
      })
    )
  }

  /** Process runner boundary. Defaults to NodeFunnelProcessRunner. */
  get process(): FunnelProcessRunner {
    return this.props.process ?? new NodeFunnelProcessRunner()
  }

  /** Logger boundary. Defaults to NodeFunnelLogger. */
  get logger(): FunnelLogger {
    return this.props.logger ?? new NodeFunnelLogger()
  }

  /** Pure factory that constructs per-type listeners and adapters from connector configs. */
  get factory(): FunnelConnectorFactory {
    return new FunnelConnectorFactory({
      fs: this.props.fs,
      process: this.props.process,
      logger: this.props.logger,
      dir: this.props.dir,
    })
  }

  /** Channel CRUD + nested connector CRUD + schedule entries + listener/adapter dispatch. */
  get channels(): FunnelChannels {
    return new FunnelChannels({
      store: this.store,
      factory: this.factory,
      profileChecker: this.profiles,
      clock: this.props.clock,
      idGenerator: this.props.idGenerator,
    })
  }

  /** Launch profiles (named presets for `fnl claude`: path + sub-agent + channel id). */
  get profiles(): FunnelProfiles {
    return new FunnelProfiles({ store: this.store })
  }

  /** funnel MCP installer (writes/removes `.mcp.json` entries in target repos). */
  get mcp(): FunnelMcp {
    return new FunnelMcp({ fs: this.props.fs })
  }

  /** Launch Claude Code with a channel injected via env, MCP installed, gateway ensured. */
  get claude(): FunnelClaude {
    return new FunnelClaude({
      channels: this.channels,
      mcp: this.mcp,
      gateway: this.gateway,
      fs: this.props.fs,
      process: this.props.process,
      logger: this.props.logger,
      dir: this.props.dir,
    })
  }

  /** Gateway daemon controller (PID-file, start/stop the separate `bun daemon.ts` process). */
  get gateway(): FunnelGateway {
    return new FunnelGateway({
      fs: this.props.fs,
      process: this.props.process,
      clock: this.props.clock,
      dir: this.props.dir,
      tmpDir: this.props.tmpDir,
    })
  }

  /** Read / generate the daemon's gateway token (mode 0600 file under `dir`). */
  get gatewayToken(): FunnelGatewayToken {
    return new FunnelGatewayToken({ fs: this.props.fs, dir: this.props.dir })
  }

  /**
   * HTTP client for listener operations on the running gateway daemon.
   * Returns `{ state: "offline" }` when the daemon is offline so hot-reload
   * paths stay write-only without parsing strings.
   */
  get listeners(): FunnelListenersClient {
    const gateway = this.gateway
    const token = this.gatewayToken

    return new FunnelListenersClient({
      port: gateway.getPort(),
      isDaemonRunning: () => gateway.isRunning(),
      getToken: () => token.read(),
    })
  }

  /**
   * In-process gateway server. Unlike `gateway.start()` (which spawns a daemon),
   * this returns a class that runs `Bun.serve` + listeners inside the current process —
   * useful for tests, embedding, or custom hosts.
   */
  gatewayServer(
    options: {
      port?: number
      logDir?: string
      killCompetingSlack?: boolean
      /** Override the auth token. Defaults to the persisted gateway.token. Pass "" to disable auth (tests). */
      token?: string
    } = {},
  ): FunnelGatewayServer {
    return new FunnelGatewayServer({
      channels: this.channels,
      settings: this.store,
      port: options.port,
      logDir: options.logDir,
      fs: this.props.fs,
      process: this.props.process,
      clock: this.props.clock,
      logger: this.props.logger,
      killCompetingSlack: options.killCompetingSlack,
      token: options.token ?? this.gatewayToken.ensure(),
    })
  }
}
