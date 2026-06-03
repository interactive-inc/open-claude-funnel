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
  /**
   * Token prompter used by FunnelLocalConfigSync when funnel.json omits a token.
   * Defaults to a TTY-only stdin prompter. Inject MemoryFunnelTokenPrompter in tests.
   */
  tokenPrompter?: FunnelTokenPrompter
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
 * const funnel = new Funnel({})
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

  private readonly fs: FunnelFileSystem
  private readonly process: FunnelProcessRunner
  private readonly logger: FunnelLogger | undefined
  private readonly clock: FunnelClock
  private readonly onError: OnFunnelError

  constructor(props: Props = {}) {
    const dir = props.dir ?? resolveFunnelDir()
    const tmpDir = props.tmpDir ?? funnelTmpDir()
    const fs = props.fs ?? new NodeFunnelFileSystem()
    const process = props.process ?? new NodeFunnelProcessRunner()
    const clock = props.clock ?? new NodeFunnelClock()
    const idGenerator = props.idGenerator ?? new NodeFunnelIdGenerator()

    this.paths = { dir, tmpDir, settings: join(dir, "settings.json") }
    this.fs = fs
    this.process = process
    this.logger = props.logger
    this.clock = clock
    this.onError = props.onError ?? noopOnError

    const store =
      props.store ??
      new FunnelSettingsStore({
        path: this.paths.settings,
        fs,
        idGenerator,
      })

    const factory = new FunnelConnectorFactory({
      fs,
      process,
      logger: this.logger,
      diagnosticLog: props.diagnosticLog,
      dir,
      slackListenerOptions: props.slackListenerOptions,
      scheduleListenerOptions: props.scheduleListenerOptions,
    })

    this.channels = new FunnelChannels({
      store,
      factory,
      clock,
      idGenerator,
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
    this.profiles = new FunnelProfiles({ store, idGenerator, fs })
    this.localConfig = new FunnelLocalConfig({ fs })
    this.localConfigSync = new FunnelLocalConfigSync({
      channels: this.channels,
      prompter: props.tokenPrompter ?? new NodeFunnelTokenPrompter(),
    })
    this.claude = new FunnelClaude({
      channels: this.channels,
      mcp,
      gateway: this.gateway,
      sessions: this.profiles,
      guard: new FileProcessGuard({ fs, process, dir }),
      process,
      logger: this.logger,
    })

    Object.freeze(this)
  }

  /**
   * Sandboxed Funnel wired with in-memory implementations for every IO boundary.
   * Touches no real disk, processes, wall-clock time, or UUIDs — safe for tests
   * and ad-hoc experiments. Override individual fields by passing them in `props`.
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
      dir: props.dir ?? SANDBOX_DIR,
      tmpDir: props.tmpDir ?? SANDBOX_TMP_DIR,
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
      hostname?: string
      dbPath?: string
      killCompetingSlack?: boolean
      token?: string
      eventLog?: FunnelEventLog
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
   * Run the gateway daemon in the foreground (tied to this terminal).
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
