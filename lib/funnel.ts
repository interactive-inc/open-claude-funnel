import { join } from "node:path"
import type { Hono } from "hono"
import { hc } from "hono/client"
import type { GatewayApp } from "@/gateway/routes"
import {
  FunnelConnectorFactory,
  type ScheduleListenerOptions,
  type SlackListenerOptions,
} from "@/connectors/connector-factory"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelClaude } from "@/engine/claude/claude"
import { FileProcessGuard } from "@/engine/claude/file-process-guard"
import { FunnelLocalConfig } from "@/engine/local-config/local-config"
import { FunnelLocalConfigSync } from "@/engine/local-config/local-config-sync"
import { FunnelMcp } from "@/engine/mcp/mcp"
import { FunnelProfiles } from "@/engine/profiles/profiles"
import { NodeFunnelTokenPrompter } from "@/engine/token-prompter/node-token-prompter"
import type { FunnelTokenPrompter } from "@/engine/token-prompter/token-prompter"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelIdGenerator } from "@/engine/id/id-generator"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import { FunnelLogger } from "@/engine/logger/logger"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { FunnelSettingsStore, resolveFunnelDir } from "@/engine/settings/settings-store"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import { FunnelClock } from "@/engine/time/clock"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { NodeFunnelClock } from "@/engine/time/node-clock"
import { FunnelChannelPublisher } from "@/gateway/channel-publisher"
import type { ConnectorDiagnosticLog } from "@/gateway/connector-diagnostic-log"
import type { Env } from "@/gateway/factory"
import type { FunnelEventLog } from "@/gateway/funnel-event-log"
import { FunnelGateway } from "@/gateway/gateway"
import { FunnelGatewayServer } from "@/gateway/gateway-server"
import { FunnelGatewayToken } from "@/gateway/gateway-token"
import { FunnelListenersClient } from "@/gateway/listeners-client"
import { buildFunnelDebugReport, type FunnelDebugReport } from "@/gateway/funnel-debug"
import { resolveDaemonScript } from "@/gateway/resolve-daemon-script"

const SANDBOX_DIR = "/sandbox/.funnel"
const SANDBOX_TMP_DIR = "/sandbox/tmp"

const noopOnError: OnFunnelError = () => {}

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
  /** Temp / runtime directory (gateway logs and PID adjacent files). Defaults to `<os.tmpdir()>/funnel`. */
  tmpDir?: string
  /**
   * Host integration hooks for Slack listeners — `onAppCreated` for attaching
   * Bolt `app.action` handlers, `preprocessEvent` for transforming/dropping
   * raw Slack events before the built-in processor sees them.
   */
  slackListenerOptions?: SlackListenerOptions
  /**
   * Host integration hooks for Schedule listeners — `onFired` is invoked after
   * each successful fire, useful for dropping one-shot entries.
   */
  scheduleListenerOptions?: ScheduleListenerOptions
  /**
   * Diagnostic log of inbound connector traffic (raw events before filtering
   * and the processor's verdict after). Threaded into listeners that record
   * it. Only the gateway daemon injects a `SqliteConnectorDiagnosticLog`; everywhere
   * else this stays absent and recording is a no-op.
   */
  diagnosticLog?: ConnectorDiagnosticLog
  /**
   * Called when Funnel catches an exception that would otherwise be silently
   * swallowed (subscriber throw, listener start/stop failure, etc.). Pass
   * `Sentry.captureException` from the host to surface these. Defaults to no-op.
   */
  onError?: OnFunnelError
  /**
   * Gateway daemon port. Passed directly to FunnelGateway so hosts can override
   * the default (9742) without setting FUNNEL_PORT in the environment.
   */
  port?: number
}

/**
 * Facade exposing every funnel facet as a getter.
 *
 * The same `Funnel` is used by the CLI and as a programmable library.
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
  private readonly memos: {
    fs?: FunnelFileSystem
    process?: FunnelProcessRunner
    clock?: FunnelClock
    idGenerator?: FunnelIdGenerator
    store?: FunnelSettingsReader
    factory?: FunnelConnectorFactory
    channels?: FunnelChannels
    gateway?: FunnelGateway
    gatewayToken?: FunnelGatewayToken
    publisher?: FunnelChannelPublisher
    listeners?: FunnelListenersClient
  } = {}

  constructor(private readonly props: Props = {}) {
    Object.freeze(this)
  }

  /**
   * Sandboxed Funnel wired with in-memory implementations for every IO boundary.
   * Touches no real disk, processes, wall-clock time, or UUIDs — safe for tests
   * and ad-hoc experiments. Override individual fields by passing them in `props`.
   */
  static inMemory(props: Props = {}): Funnel {
    return new Funnel({
      store: props.store ?? new MockFunnelSettingsReader(),
      fs: props.fs ?? new MemoryFunnelFileSystem(),
      process: props.process ?? new MemoryFunnelProcessRunner(),
      logger: props.logger ?? new MemoryFunnelLogger(),
      clock: props.clock ?? new MemoryFunnelClock(),
      idGenerator: props.idGenerator ?? new MemoryFunnelIdGenerator(),
      dir: props.dir ?? SANDBOX_DIR,
      tmpDir: props.tmpDir ?? SANDBOX_TMP_DIR,
    })
  }

  /** Resolved on-disk paths the facade will read/write when methods are called. Pure compute, not memoized. */
  get paths(): { dir: string; tmpDir: string; settings: string } {
    const dir = this.props.dir ?? resolveFunnelDir()
    const tmpDir = this.props.tmpDir ?? funnelTmpDir()

    return { dir, tmpDir, settings: join(dir, "settings.json") }
  }

  private get fs(): FunnelFileSystem {
    if (!this.memos.fs) this.memos.fs = this.props.fs ?? new NodeFunnelFileSystem()

    return this.memos.fs
  }

  private get process(): FunnelProcessRunner {
    if (!this.memos.process)
      this.memos.process = this.props.process ?? new NodeFunnelProcessRunner()

    return this.memos.process
  }

  private get logger(): FunnelLogger | undefined {
    return this.props.logger
  }

  private get clock(): FunnelClock {
    if (!this.memos.clock) this.memos.clock = this.props.clock ?? new NodeFunnelClock()

    return this.memos.clock
  }

  private get onError(): OnFunnelError {
    return this.props.onError ?? noopOnError
  }

  private get idGenerator(): FunnelIdGenerator {
    if (!this.memos.idGenerator) {
      this.memos.idGenerator = this.props.idGenerator ?? new NodeFunnelIdGenerator()
    }

    return this.memos.idGenerator
  }

  private get store(): FunnelSettingsReader {
    if (!this.memos.store) {
      this.memos.store =
        this.props.store ??
        new FunnelSettingsStore({
          path: this.paths.settings,
          fs: this.fs,
          idGenerator: this.idGenerator,
        })
    }

    return this.memos.store
  }

  private get factory(): FunnelConnectorFactory {
    if (!this.memos.factory) {
      this.memos.factory = new FunnelConnectorFactory({
        fs: this.fs,
        process: this.process,
        logger: this.logger,
        diagnosticLog: this.props.diagnosticLog,
        dir: this.paths.dir,
        slackListenerOptions: this.props.slackListenerOptions,
        scheduleListenerOptions: this.props.scheduleListenerOptions,
      })
    }

    return this.memos.factory
  }

  /** Channel CRUD + nested connector CRUD + schedule entries + listener/adapter dispatch. */
  get channels(): FunnelChannels {
    if (!this.memos.channels) {
      this.memos.channels = new FunnelChannels({
        store: this.store,
        factory: this.factory,
        clock: this.clock,
        idGenerator: this.idGenerator,
      })
    }

    return this.memos.channels
  }

  /** Gateway daemon controller (PID-file, start/stop the separate `bun daemon.ts` process). */
  get gateway(): FunnelGateway {
    if (!this.memos.gateway) {
      this.memos.gateway = new FunnelGateway({
        fs: this.fs,
        process: this.process,
        clock: this.clock,
        dir: this.paths.dir,
        tmpDir: this.paths.tmpDir,
        port: this.props.port,
      })
    }

    return this.memos.gateway
  }

  /** Read / generate the daemon's gateway token (mode 0600 file under `dir`). */
  get gatewayToken(): FunnelGatewayToken {
    if (!this.memos.gatewayToken) {
      this.memos.gatewayToken = new FunnelGatewayToken({ fs: this.fs, dir: this.paths.dir })
    }

    return this.memos.gatewayToken
  }

  /**
   * HTTP client for `POST /channels/:channel/publish` on the running gateway
   * daemon. Use it to push arbitrary content into a channel from outside any
   * connector. Returns `{ state: "offline" }` if the daemon isn't up.
   */
  get publisher(): FunnelChannelPublisher {
    if (!this.memos.publisher) {
      const gateway = this.gateway
      const token = this.gatewayToken

      this.memos.publisher = new FunnelChannelPublisher({
        port: gateway.getPort(),
        isDaemonRunning: () => gateway.isRunning(),
        getToken: () => token.read(),
      })
    }

    return this.memos.publisher
  }

  /**
   * HTTP client for listener operations on the running gateway daemon.
   * Returns `{ state: "offline" }` when the daemon is offline so hot-reload
   * paths stay write-only without parsing strings.
   */
  get listeners(): FunnelListenersClient {
    if (!this.memos.listeners) {
      const gateway = this.gateway
      const token = this.gatewayToken

      this.memos.listeners = new FunnelListenersClient({
        port: gateway.getPort(),
        isDaemonRunning: () => gateway.isRunning(),
        getToken: () => token.read(),
      })
    }

    return this.memos.listeners
  }

  /**
   * In-process gateway server. Unlike `gateway.start()` (which spawns a daemon),
   * this returns a class that runs `Bun.serve` + listeners inside the current process —
   * useful for tests, embedding, or custom hosts.
   */
  gatewayServer(
    options: {
      port?: number
      /** Bind address. Defaults to `127.0.0.1` (loopback only). Set to `0.0.0.0` to expose on the network. */
      hostname?: string
      dbPath?: string
      killCompetingSlack?: boolean
      /** Override the auth token. Defaults to the persisted gateway.token. Pass "" to disable auth (tests). */
      token?: string
      /** Durable replay log. Defaults to a SqliteFunnelEventLog at dbPath; inject a MemoryFunnelEventLog (or any FunnelEventLog) to swap or disable persistence. */
      eventLog?: FunnelEventLog
      /**
       * Additional hono app mounted before the built-in gateway routes.
       * Use to embed host-specific endpoints (e.g. an MCP route, custom `/api/*`).
       * Host routes are mounted first; built-in `/listeners`, `/status`,
       * `/channels`, `/health` are mounted after and take precedence on conflict.
       */
      extraRoutes?: Hono<Env>
    } = {},
  ): FunnelGatewayServer {
    return new FunnelGatewayServer({
      channels: this.channels,
      port: options.port,
      hostname: options.hostname,
      dbPath: options.dbPath,
      eventLog: options.eventLog,
      process: this.process,
      clock: this.clock,
      logger: this.logger,
      onError: this.onError,
      dir: this.paths.dir,
      killCompetingSlack: options.killCompetingSlack,
      token: options.token ?? this.gatewayToken.ensure(),
      extraRoutes: options.extraRoutes,
    })
  }

  /**
   * Build the Claude Code launcher with all dependencies wired from this Funnel.
   * Returns a tuple of the launcher and supporting objects needed by the CLI.
   */
  buildClaude(tokenPrompter?: FunnelTokenPrompter): {
    claude: FunnelClaude
    profiles: FunnelProfiles
    localConfig: FunnelLocalConfig
    localConfigSync: FunnelLocalConfigSync
  } {
    const mcp = new FunnelMcp({ fs: this.fs })
    const profiles = new FunnelProfiles({
      store: this.store,
      idGenerator: this.idGenerator,
      fs: this.fs,
    })
    const localConfig = new FunnelLocalConfig({ fs: this.fs })
    const localConfigSync = new FunnelLocalConfigSync({
      channels: this.channels,
      prompter: tokenPrompter ?? new NodeFunnelTokenPrompter(),
    })
    const guard = new FileProcessGuard({
      fs: this.fs,
      process: this.process,
      dir: this.paths.dir,
    })
    const claude = new FunnelClaude({
      channels: this.channels,
      mcp,
      gateway: this.gateway,
      sessions: profiles,
      guard,
      fs: this.fs,
      process: this.process,
      idGenerator: this.idGenerator,
      logger: this.logger,
    })

    return { claude, profiles, localConfig, localConfigSync }
  }

  /**
   * Run the gateway daemon in the foreground (tied to this terminal).
   * On macOS wraps with `caffeinate -is` by default.
   * For background daemon management, use `funnel.gateway.start()` instead.
   */
  async runGatewayForeground(options: { caffeinate?: boolean } = {}): Promise<number> {
    const gatewayScript = resolveDaemonScript()
    const useCaffeinate =
      options.caffeinate !== false && globalThis.process.platform === "darwin"
    const command = useCaffeinate
      ? ["caffeinate", "-is", "bun", gatewayScript]
      : ["bun", gatewayScript]

    return this.process.attach(command)
  }

  async debug(channelName?: string): Promise<FunnelDebugReport> {
    return buildFunnelDebugReport(
      { gateway: this.gateway, channels: this.channels, tmpDir: this.paths.tmpDir },
      channelName ?? null,
    )
  }

  gatewayClient(): ReturnType<typeof hc<GatewayApp>> {
    const { port } = this.gateway.getStatus()

    return hc<GatewayApp>(`http://127.0.0.1:${port}`)
  }
}
