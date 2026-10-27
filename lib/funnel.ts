import { join } from "node:path"
import { hc } from "hono/client"
import { gatewayLoopbackUrl } from "@/engine/http/gateway-base-url"
import type { GatewayApp } from "@/gateway/routes"
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
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { FunnelSettingsStore, resolveFunnelDir } from "@/engine/settings/settings-store"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { NodeFunnelClock } from "@/engine/time/node-clock"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"
import { MemoryFunnelTokenPrompter } from "@/engine/token-prompter/memory-token-prompter"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import { FunnelChannelPublisher } from "@/gateway/channel-publisher"
import { FunnelGateway } from "@/gateway/gateway"
import type { FunnelGatewayModule } from "@/gateway/gateway-module"
import type { FunnelGatewayServer } from "@/gateway/gateway-server"
import { FunnelGatewayToken } from "@/gateway/gateway-token"
import { FunnelListenersClient } from "@/gateway/listeners-client"
import { resolveDaemonScript } from "@/gateway/resolve-daemon-script"

import {
  FunnelTransport,
  type GatewayServerOptions,
  type GatewayModuleOptions,
  type FunnelTransportOptions,
} from "@/transport"
export type { GatewayServerOptions, GatewayModuleOptions } from "@/transport"

const SANDBOX_DIR = "/sandbox/.funnel"
const SANDBOX_TMP_DIR = "/sandbox/tmp"

type Props = Omit<FunnelTransportOptions, "profileChecker"> & {
  /** Daemon port for the full facade. Embedded transports pass port to their gateway. */
  port?: number
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
  readonly transport: FunnelTransport
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

    const store =
      props.store ??
      new FunnelSettingsStore({
        path: this.paths.settings,
        fs,
        idGenerator,
      })

    this.profiles = new FunnelProfiles({ store, idGenerator, fs })
    this.transport = new FunnelTransport({
      ...props,
      dir,
      tmpDir,
      store,
      fs,
      process,
      clock,
      idGenerator,
      http,
      profileChecker: this.profiles,
    })
    this.channels = this.transport.channels

    this.gateway = new FunnelGateway({
      fs,
      process,
      clock,
      dir,
      tmpDir,
      port: props.port,
    })

    this.gatewayToken = this.transport.gatewayToken

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
      logger: props.logger,
      dir,
    })

    this.diagnostics = new FunnelDiagnostics({
      gateway: this.gateway,
      gatewayToken: this.gatewayToken,
      channels: this.channels,
      publisher: this.publisher,
      diagnosticLog: props.diagnosticLog,
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
    return this.transport.gatewayServer(options)
  }

  /** Mount the shared transport on a host-owned server. */
  gatewayModule(options: GatewayModuleOptions = {}): FunnelGatewayModule {
    return this.transport.gatewayModule(options)
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
