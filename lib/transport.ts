import { join } from "node:path"
import type { Hono } from "hono"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { FunnelChannels } from "@/engine/channels/channels"
import type { ProfileChannelChecker } from "@/engine/profiles/profile-channel-checker"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import type { FunnelFileSystem } from "@/engine/fs/file-system"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import type { FunnelIdGenerator } from "@/engine/id/id-generator"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { NodeFunnelIdGenerator } from "@/engine/id/node-id-generator"
import type { FunnelLogger } from "@/engine/logger/logger"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import type { FunnelProcessRunner } from "@/engine/process/process-runner"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import type { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import { FunnelSettingsStore, resolveFunnelDir } from "@/engine/settings/settings-store"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import type { FunnelClock } from "@/engine/time/clock"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { NodeFunnelClock } from "@/engine/time/node-clock"
import type { FunnelHttpClient } from "@/engine/http/http-client"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import type { Env } from "@/gateway/factory"
import { FunnelGatewayModule, type GatewayEventStore } from "@/gateway/gateway-module"
import { FunnelGatewayServer } from "@/gateway/gateway-server"
import { FunnelGatewayToken } from "@/gateway/gateway-token"

/** Dependencies for transport only; no agent launcher, profiles, or daemon controller. */
export type FunnelTransportOptions = {
  store?: FunnelSettingsReader
  fs?: FunnelFileSystem
  process?: FunnelProcessRunner
  logger?: FunnelLogger
  clock?: FunnelClock
  idGenerator?: FunnelIdGenerator
  dir?: string
  tmpDir?: string
  connectors?: ConnectorDescriptor[]
  diagnosticLog?: ConnectorDiagnosticLog
  onError?: OnFunnelError
  http?: FunnelHttpClient
  signal?: AbortSignal
  /** Host-owned references that must prevent channel deletion. */
  profileChecker?: ProfileChannelChecker
}

export type GatewayServerOptions = GatewayEventStore & {
  port?: number
  hostname?: string
  killCompetingSlack?: boolean
  token?: string
  allowInsecureHost?: boolean
  extraRoutes?: Hono<Env>
}

export type GatewayModuleOptions = GatewayEventStore & {
  port?: number
  killCompetingSlack?: boolean
  token?: string
  extraRoutes?: Hono<Env>
  healthRoute?: boolean
}

/** Channels, connectors and durable gateway delivery for a host-owned agent runtime. */
export class FunnelTransport {
  readonly paths: { dir: string; tmpDir: string; settings: string }
  readonly channels: FunnelChannels
  readonly gatewayToken: FunnelGatewayToken
  private readonly process: FunnelProcessRunner
  private readonly clock: FunnelClock
  private readonly logger: FunnelLogger | undefined
  private readonly onError: OnFunnelError
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined

  constructor(props: FunnelTransportOptions = {}) {
    const dir = props.dir ?? resolveFunnelDir()
    const tmpDir = props.tmpDir ?? funnelTmpDir()
    const fs = props.fs ?? new NodeFunnelFileSystem()
    const process = props.process ?? new NodeFunnelProcessRunner()
    const clock = props.clock ?? new NodeFunnelClock()
    const idGenerator = props.idGenerator ?? new NodeFunnelIdGenerator()
    const store =
      props.store ?? new FunnelSettingsStore({ path: join(dir, "settings.json"), fs, idGenerator })
    const registry = new FunnelConnectorRegistry({
      descriptors: props.connectors ?? [],
      fs,
      process,
      clock,
      dir,
      http: props.http ?? new NodeFunnelHttpClient(),
      logger: props.logger,
      diagnosticLog: props.diagnosticLog,
      signal: props.signal,
    })
    this.paths = { dir, tmpDir, settings: join(dir, "settings.json") }
    this.process = process
    this.clock = clock
    this.logger = props.logger
    this.onError = props.onError ?? (() => {})
    this.diagnosticLog = props.diagnosticLog
    this.channels = new FunnelChannels({
      store,
      registry,
      clock,
      idGenerator,
      // Keep existing persisted references safe without constructing the launcher layer.
      profileChecker: props.profileChecker ?? {
        hasChannelRef: (id) => store.read().profiles.some((profile) => profile.channelId === id),
      },
    })
    this.gatewayToken = new FunnelGatewayToken({ fs, dir })
    Object.freeze(this)
  }

  /** Memory IO does not stub Bun.serve or connector transport; inject those separately. */
  static inMemory(props: FunnelTransportOptions = {}): FunnelTransport {
    return new FunnelTransport({
      ...props,
      store: props.store ?? new MockFunnelSettingsReader(),
      fs: props.fs ?? new MemoryFunnelFileSystem(),
      process: props.process ?? new MemoryFunnelProcessRunner(),
      logger: props.logger ?? new MemoryFunnelLogger(),
      clock: props.clock ?? new MemoryFunnelClock(),
      idGenerator: props.idGenerator ?? new MemoryFunnelIdGenerator(),
      http: props.http ?? new MemoryFunnelHttpClient(),
      diagnosticLog: props.diagnosticLog ?? new MemoryConnectorDiagnosticLog(),
      dir: props.dir ?? "/sandbox/.funnel",
      tmpDir: props.tmpDir ?? "/sandbox/tmp",
    })
  }

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
      diagnosticLog: this.diagnosticLog,
    })
  }

  /**
   * Mountable in-process gateway. Everything `gatewayServer()` runs except the
   * bind: the host owns its own Hono tree and `Bun.serve` and mounts this.
   *
   * @example
   * ```ts
   * const gw = funnel.gatewayModule({ token })
   * const app = new Hono().route("/", hostRoutes).route("/", gw.app)
   *
   * Bun.serve({
   *   port,
   *   fetch: (req, server) => {
   *     const upgrade = gw.handleUpgrade(req, server)
   *     return upgrade.handled ? upgrade.response : app.fetch(req)
   *   },
   *   websocket: gw.websocket,
   * })
   *
   * await gw.start()
   * ```
   */
  gatewayModule(options: GatewayModuleOptions = {}): FunnelGatewayModule {
    return new FunnelGatewayModule({
      channels: this.channels,
      // EventStore is a union (dbPath xor eventLog); spread it so exactly one reaches the module.
      ...(options.eventLog ? { eventLog: options.eventLog } : { dbPath: options.dbPath }),
      process: this.process,
      clock: this.clock,
      logger: this.logger,
      onError: this.onError,
      dir: this.paths.dir,
      tmpDir: this.paths.tmpDir,
      port: options.port,
      killCompetingSlack: options.killCompetingSlack,
      token: options.token ?? this.gatewayToken.ensure(),
      extraRoutes: options.extraRoutes,
      healthRoute: options.healthRoute,
      diagnosticLog: this.diagnosticLog,
    })
  }
}
