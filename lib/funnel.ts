import { join } from "node:path"
import { FunnelConnectorFactory } from "@/connectors/connector-factory"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelClaude } from "@/engine/claude/claude"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelIdGenerator } from "@/engine/id/id-generator"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import { FunnelLogger } from "@/engine/logger/logger"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { FunnelMcp } from "@/engine/mcp/mcp"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FunnelProfiles } from "@/engine/profiles/profiles"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { FUNNEL_DIR, FunnelSettingsStore } from "@/engine/settings/settings-store"
import { FunnelClock } from "@/engine/time/clock"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { NodeFunnelClock } from "@/engine/time/node-clock"
import { FunnelChannelPublisher } from "@/gateway/channel-publisher"
import { FunnelGateway } from "@/gateway/gateway"
import { FunnelGatewayServer } from "@/gateway/gateway-server"
import { FunnelGatewayToken } from "@/gateway/gateway-token"
import { FunnelListenersClient } from "@/gateway/listeners-client"

const DEFAULT_TMP_DIR = "/tmp/funnel"
const SANDBOX_DIR = "/sandbox/.funnel"
const SANDBOX_TMP_DIR = "/sandbox/tmp"

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
  private readonly cache = new Map<string, unknown>()

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

  private memo<T>(key: string, build: () => T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T

    const value = build()
    this.cache.set(key, value)

    return value
  }

  /** Resolved on-disk paths the facade will read/write when methods are called. Pure compute, not memoized. */
  get paths(): { dir: string; tmpDir: string; settings: string } {
    const dir = this.props.dir ?? FUNNEL_DIR
    const tmpDir = this.props.tmpDir ?? DEFAULT_TMP_DIR

    return { dir, tmpDir, settings: join(dir, "settings.json") }
  }

  /** Filesystem boundary. Defaults to NodeFunnelFileSystem. */
  get fs(): FunnelFileSystem {
    return this.memo("fs", () => this.props.fs ?? new NodeFunnelFileSystem())
  }

  /** Process runner boundary. Defaults to NodeFunnelProcessRunner. */
  get process(): FunnelProcessRunner {
    return this.memo("process", () => this.props.process ?? new NodeFunnelProcessRunner())
  }

  /** Logger boundary. Defaults to NodeFunnelLogger. */
  get logger(): FunnelLogger {
    return this.memo("logger", () => this.props.logger ?? new NodeFunnelLogger())
  }

  /** Clock boundary. Defaults to NodeFunnelClock. */
  get clock(): FunnelClock {
    return this.memo("clock", () => this.props.clock ?? new NodeFunnelClock())
  }

  /** ID generator boundary. Defaults to NodeFunnelIdGenerator. */
  get idGenerator(): FunnelIdGenerator {
    return this.memo("idGenerator", () => this.props.idGenerator ?? new NodeFunnelIdGenerator())
  }

  /** Settings reader. If not injected, a FunnelSettingsStore rooted at `dir` is created. */
  get store(): FunnelSettingsReader {
    return this.memo(
      "store",
      () =>
        this.props.store ??
        new FunnelSettingsStore({
          path: this.paths.settings,
          fs: this.fs,
        }),
    )
  }

  /** Pure factory that constructs per-type listeners and adapters from connector configs. */
  get factory(): FunnelConnectorFactory {
    return this.memo(
      "factory",
      () =>
        new FunnelConnectorFactory({
          fs: this.fs,
          process: this.process,
          logger: this.logger,
          dir: this.paths.dir,
        }),
    )
  }

  /** Channel CRUD + nested connector CRUD + schedule entries + listener/adapter dispatch. */
  get channels(): FunnelChannels {
    return this.memo(
      "channels",
      () =>
        new FunnelChannels({
          store: this.store,
          factory: this.factory,
          profileChecker: this.profiles,
          clock: this.clock,
          idGenerator: this.idGenerator,
        }),
    )
  }

  /** Launch profiles (named presets for `fnl claude`: path + sub-agent + channel id). */
  get profiles(): FunnelProfiles {
    return this.memo("profiles", () => new FunnelProfiles({ store: this.store }))
  }

  /** funnel MCP installer (writes/removes `.mcp.json` entries in target repos). */
  get mcp(): FunnelMcp {
    return this.memo("mcp", () => new FunnelMcp({ fs: this.fs }))
  }

  /** Launch Claude Code with a channel injected via env, MCP installed, gateway ensured. */
  get claude(): FunnelClaude {
    return this.memo(
      "claude",
      () =>
        new FunnelClaude({
          channels: this.channels,
          mcp: this.mcp,
          gateway: this.gateway,
          fs: this.fs,
          process: this.process,
          logger: this.logger,
          dir: this.paths.dir,
        }),
    )
  }

  /** Gateway daemon controller (PID-file, start/stop the separate `bun daemon.ts` process). */
  get gateway(): FunnelGateway {
    return this.memo(
      "gateway",
      () =>
        new FunnelGateway({
          fs: this.fs,
          process: this.process,
          clock: this.clock,
          dir: this.paths.dir,
          tmpDir: this.paths.tmpDir,
        }),
    )
  }

  /** Read / generate the daemon's gateway token (mode 0600 file under `dir`). */
  get gatewayToken(): FunnelGatewayToken {
    return this.memo(
      "gatewayToken",
      () => new FunnelGatewayToken({ fs: this.fs, dir: this.paths.dir }),
    )
  }

  /**
   * HTTP client for `POST /channels/:channel/publish` on the running gateway
   * daemon. Use it to push arbitrary content into a channel from outside any
   * connector. Returns `{ state: "offline" }` if the daemon isn't up.
   */
  get publisher(): FunnelChannelPublisher {
    return this.memo("publisher", () => {
      const gateway = this.gateway
      const token = this.gatewayToken

      return new FunnelChannelPublisher({
        port: gateway.getPort(),
        isDaemonRunning: () => gateway.isRunning(),
        getToken: () => token.read(),
      })
    })
  }

  /**
   * HTTP client for listener operations on the running gateway daemon.
   * Returns `{ state: "offline" }` when the daemon is offline so hot-reload
   * paths stay write-only without parsing strings.
   */
  get listeners(): FunnelListenersClient {
    return this.memo("listeners", () => {
      const gateway = this.gateway
      const token = this.gatewayToken

      return new FunnelListenersClient({
        port: gateway.getPort(),
        isDaemonRunning: () => gateway.isRunning(),
        getToken: () => token.read(),
      })
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
      process: this.process,
      clock: this.clock,
      logger: this.logger,
      killCompetingSlack: options.killCompetingSlack,
      token: options.token ?? this.gatewayToken.ensure(),
    })
  }
}
