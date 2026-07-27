import { join } from "node:path"
import type { Hono } from "hono"
import { hc } from "hono/client"
import { gatewayLoopbackUrl } from "@/engine/http/gateway-base-url"
import type { GatewayApp } from "@/gateway/routes"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelClaude } from "@/engine/claude/claude"
import { FunnelFileProcessGuard } from "@/engine/claude/file-process-guard"
import { FunnelFileSessionStore } from "@/engine/claude/file-session-store"
import { FunnelRoutedSessionStore } from "@/engine/claude/routed-session-store"
import { FunnelDiagnostics } from "@/services/diagnostics/funnel-diagnostics"
import { FunnelDoctor } from "@/services/doctor/funnel-doctor"
import { FunnelDocs } from "@/engine/docs/funnel-docs"
import { FunnelLocalConfig } from "@/services/local-config/local-config"
import { FunnelLocalConfigSync } from "@/services/local-config/local-config-sync"
import { FunnelMcp } from "@/engine/mcp/mcp"
import { FunnelProfiles } from "@/engine/profiles/profiles"
import { FunnelRecovery } from "@/services/recovery/funnel-recovery"
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
import { FunnelHttpClient } from "@/engine/http/http-client"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"
import { MemoryFunnelTokenPrompter } from "@/engine/token-prompter/memory-token-prompter"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import { FunnelChannelPublisher } from "@/gateway/channel-publisher"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { Env } from "@/gateway/factory"
import { FunnelGateway } from "@/gateway/gateway"
import { FunnelGatewayServer, type GatewayEventStore } from "@/gateway/gateway-server"
import { FunnelGatewayToken } from "@/gateway/gateway-token"
import { FunnelListenersClient } from "@/gateway/listeners-client"
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
   * Connector types this funnel handles, passed as descriptors. Core imports no
   * connector, so a type's listener/adapter code is bundled only when its
   * descriptor is imported and listed here. Import from the per-type sub-entries:
   * `import { slackConnector } from "@interactive-inc/claude-funnel/connectors/slack"`.
   * Only `scheduleConnector` currently takes options (`{ onFired }`); the other
   * types build their listeners from the Flume sources directly. Defaults to
   * `[]` — no connectors handled.
   */
  connectors?: ConnectorDescriptor[]
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
  /**
   * Token prompter used by FunnelLocalConfigSync when funnel.json omits a token.
   * Defaults to a TTY-only stdin prompter. Inject MemoryFunnelTokenPrompter in tests.
   */
  tokenPrompter?: FunnelTokenPrompter
  /**
   * HTTP client used by connector adapters and listeners (e.g. Slack
   * auth.test, reactions.add, Web API; Discord REST). Defaults to
   * `NodeFunnelHttpClient` (global `fetch`). Inject `MemoryFunnelHttpClient`
   * in tests to assert request shape and stub responses without network.
   */
  http?: FunnelHttpClient
  /**
   * Shutdown signal forwarded to every flume-backed listener built by this
   * funnel's connector registry. Wire a single `AbortController` here from a
   * host-level SIGTERM handler so every listener's Flume tears down its
   * WebSocket / fetch loop together when the host shuts down.
   */
  signal?: AbortSignal
}

/**
 * Options for `Funnel.gatewayServer()`. The event store is a union (`dbPath`
 * xor `eventLog`) so the two storage modes can't be mixed.
 */
export type GatewayServerOptions = GatewayEventStore & {
  port?: number
  hostname?: string
  killCompetingSlack?: boolean
  token?: string
  /** Permit a non-loopback `hostname` without a token. See FunnelGatewayServer. */
  allowInsecureHost?: boolean
  extraRoutes?: Hono<Env>
}

/**
 * Facade that wires every funnel facet together and exposes the public surface.
 *
 * All side-effecting boundaries (filesystem, process, logger, clock, id, paths)
 * are injected via Props — passing memory implementations gives a fully sandboxed
 * Funnel that touches no real disk, processes, or wall-clock time.
 *
 * Fully immutable: all fields are resolved in the constructor and frozen.
 * No lazy initialisation — every dependency is wired at construction time.
 *
 * @example
 * ```ts
 * import { slackConnector } from "@interactive-inc/claude-funnel/connectors/slack"
 *
 * const funnel = new Funnel({ connectors: [slackConnector()] })
 * const channel = funnel.channels.add({ name: "inbox" })
 * funnel.channels.addConnector("inbox", { type: "slack", name: "ops", botToken, appToken })
 * await funnel.gatewayServer({ port: 9742 }).start()
 * ```
 */
export class Funnel {
  readonly paths: { dir: string; tmpDir: string; settings: string }
  readonly channels: FunnelChannels
  readonly gateway: FunnelGateway
  readonly gatewayToken: FunnelGatewayToken
  readonly publisher: FunnelChannelPublisher
  readonly listeners: FunnelListenersClient
  readonly claude: FunnelClaude
  readonly profiles: FunnelProfiles
  readonly localConfig: FunnelLocalConfig
  readonly localConfigSync: FunnelLocalConfigSync
  readonly diagnostics: FunnelDiagnostics
  readonly recovery: FunnelRecovery
  readonly doctor: FunnelDoctor
  readonly docs: FunnelDocs

  private readonly fs: FunnelFileSystem
  private readonly process: FunnelProcessRunner
  private readonly logger: FunnelLogger | undefined
  private readonly clock: FunnelClock
  private readonly http: FunnelHttpClient
  private readonly onError: OnFunnelError

  constructor(props: Props = {}) {
    const dir = props.dir ?? resolveFunnelDir()
    const tmpDir = props.tmpDir ?? funnelTmpDir()
    const fs = props.fs ?? new NodeFunnelFileSystem()
    const process = props.process ?? new NodeFunnelProcessRunner()
    const clock = props.clock ?? new NodeFunnelClock()
    const idGenerator = props.idGenerator ?? new NodeFunnelIdGenerator()
    const http = props.http ?? new NodeFunnelHttpClient()

    this.paths = { dir, tmpDir, settings: join(dir, "settings.json") }
    this.fs = fs
    this.process = process
    this.logger = props.logger
    this.clock = clock
    this.http = http
    this.onError = props.onError ?? noopOnError

    const store =
      props.store ??
      new FunnelSettingsStore({
        path: this.paths.settings,
        fs,
        idGenerator,
      })

    const registry = new FunnelConnectorRegistry({
      descriptors: props.connectors ?? [],
      fs,
      process,
      http,
      clock,
      logger: this.logger,
      diagnosticLog: props.diagnosticLog,
      signal: props.signal,
      dir,
    })

    this.profiles = new FunnelProfiles({ store, idGenerator, fs })

    // profiles doubles as the ProfileChannelChecker so channels.remove can
    // refuse to orphan a profile that still points at the channel.
    this.channels = new FunnelChannels({
      store,
      registry,
      clock,
      idGenerator,
      profileChecker: this.profiles,
    })

    this.gateway = new FunnelGateway({
      fs,
      process,
      clock,
      dir,
      tmpDir,
      port: props.port,
    })

    this.gatewayToken = new FunnelGatewayToken({ fs, dir })

    this.publisher = new FunnelChannelPublisher({
      port: this.gateway.getPort(),
      isDaemonRunning: () => this.gateway.isRunning(),
      getToken: () => this.gatewayToken.read(),
    })

    this.listeners = new FunnelListenersClient({
      port: this.gateway.getPort(),
      isDaemonRunning: () => this.gateway.isRunning(),
      getToken: () => this.gatewayToken.read(),
    })

    const mcp = new FunnelMcp({ fs })
    this.localConfig = new FunnelLocalConfig({ fs })
    this.localConfigSync = new FunnelLocalConfigSync({
      channels: this.channels,
      prompter: props.tokenPrompter ?? new NodeFunnelTokenPrompter(),
    })
    const sessions = new FunnelRoutedSessionStore({
      global: this.profiles,
      local: new FunnelFileSessionStore({ fs, dir }),
    })
    this.claude = new FunnelClaude({
      channels: this.channels,
      mcp,
      gateway: this.gateway,
      sessions,
      guard: new FunnelFileProcessGuard({ fs, process, dir }),
      process,
      logger: this.logger,
      dir,
    })

    this.diagnostics = new FunnelDiagnostics({
      gateway: this.gateway,
      gatewayToken: this.gatewayToken,
      channels: this.channels,
      publisher: this.publisher,
      tmpDir,
    })

    this.recovery = new FunnelRecovery({
      gateway: this.gateway,
      listeners: this.listeners,
      channels: this.channels,
    })

    this.doctor = new FunnelDoctor({
      diagnostics: this.diagnostics,
      recovery: this.recovery,
    })

    this.docs = new FunnelDocs()

    Object.freeze(this)
  }

  /**
   * Sandboxed Funnel wired with in-memory implementations for every IO
   * boundary. Touches no real disk, processes, wall-clock time, UUIDs, HTTP,
   * TTY prompts, or diagnostic SQLite — safe for tests and ad-hoc
   * experiments. Override individual fields by passing them in `props`.
   *
   * NOT covered by `inMemory()`:
   *   - `gatewayServer()` still calls `Bun.serve` and binds a real port; use
   *     `port: 0` to let the OS pick one. The WebSocket subscription path
   *     also crosses the real socket.
   *   - Flume sources opened by listeners (Slack Socket Mode, Discord
   *     Gateway, GitHub poll) still open real WebSockets / HTTP. Pass
   *     `flumeDeps` to the descriptor's options if a test needs them stubbed.
   *   - `funnel.gateway` (daemon process) — `start()` still spawns a child
   *     process; only the in-process `gatewayServer()` is sandbox-friendly.
   */
  static inMemory(props: Props = {}): Funnel {
    return new Funnel({
      ...props,
      store: props.store ?? new MockFunnelSettingsReader(),
      fs: props.fs ?? new MemoryFunnelFileSystem(),
      process: props.process ?? new MemoryFunnelProcessRunner(),
      logger: props.logger ?? new MemoryFunnelLogger(),
      clock: props.clock ?? new MemoryFunnelClock(),
      idGenerator: props.idGenerator ?? new MemoryFunnelIdGenerator(),
      http: props.http ?? new MemoryFunnelHttpClient(),
      tokenPrompter: props.tokenPrompter ?? new MemoryFunnelTokenPrompter(),
      diagnosticLog: props.diagnosticLog ?? new MemoryConnectorDiagnosticLog(),
      dir: props.dir ?? SANDBOX_DIR,
      tmpDir: props.tmpDir ?? SANDBOX_TMP_DIR,
    })
  }

  /**
   * In-process gateway server. Unlike `gateway.start()` (which spawns a daemon),
   * this returns a class that runs `Bun.serve` + listeners inside the current process —
   * useful for tests, embedding, or custom hosts.
   */
  gatewayServer(options: GatewayServerOptions = {}): FunnelGatewayServer {
    return new FunnelGatewayServer({
      channels: this.channels,
      port: options.port,
      hostname: options.hostname,
      // EventStore is a union (dbPath xor eventLog); spread it so exactly one reaches the server.
      ...(options.eventLog ? { eventLog: options.eventLog } : { dbPath: options.dbPath }),
      process: this.process,
      clock: this.clock,
      logger: this.logger,
      onError: this.onError,
      dir: this.paths.dir,
      tmpDir: this.paths.tmpDir,
      killCompetingSlack: options.killCompetingSlack,
      token: options.token ?? this.gatewayToken.ensure(),
      allowInsecureHost: options.allowInsecureHost,
      extraRoutes: options.extraRoutes,
    })
  }

  /**
   * Create a ProcessGuard scoped to this Funnel's home directory.
   * Useful for hosts that need to check or manage singleton PID files
   * independently of FunnelClaude (e.g. checking if a named profile is running).
   */
  createProcessGuard(): FunnelFileProcessGuard {
    return new FunnelFileProcessGuard({
      fs: this.fs,
      process: this.process,
      dir: this.paths.dir,
    })
  }

  /**
   * Run the gateway daemon in the foreground (tied to this terminal).
   * For background daemon management, use `funnel.gateway.start()` instead.
   */
  async runGatewayForeground(options: { caffeinate?: boolean } = {}): Promise<number> {
    const gatewayScript = resolveDaemonScript()
    const useCaffeinate = options.caffeinate !== false && globalThis.process.platform === "darwin"
    const command = useCaffeinate
      ? ["caffeinate", "-is", "bun", gatewayScript]
      : ["bun", gatewayScript]

    return this.process.attach(command, {
      env: {
        FUNNEL_DIR: this.paths.dir,
        FUNNEL_PORT: String(this.gateway.getPort()),
        FUNNEL_TMP_DIR: this.paths.tmpDir,
      },
    })
  }

  gatewayClient(): ReturnType<typeof hc<GatewayApp>> {
    const { port } = this.gateway.getStatus()

    return hc<GatewayApp>(gatewayLoopbackUrl(port))
  }
}
