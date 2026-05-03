import { join } from "node:path"
import { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelClaude } from "@/modules/claude/funnel-claude"
import {
  type ConnectorStoresBundle,
  createConnectorStores,
} from "@/modules/connectors/funnel-connector-stores"
import { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
import type { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { FunnelGateway } from "@/modules/gateway/funnel-gateway"
import { FunnelGatewayServer } from "@/modules/gateway/funnel-gateway-server"
import type { FunnelIdGenerator } from "@/modules/id/funnel-id-generator"
import type { FunnelLogger } from "@/modules/logger/funnel-logger"
import { FunnelMcp } from "@/modules/mcp/funnel-mcp"
import type { FunnelProcessRunner } from "@/modules/process/funnel-process-runner"
import { FunnelProfiles } from "@/modules/profiles/funnel-profiles"
import { FunnelRepositories } from "@/modules/repos/funnel-repositories"
import { FunnelSchedule } from "@/modules/schedule/funnel-schedule"
import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"
import { FUNNEL_DIR, FunnelSettingsStore } from "@/modules/settings/funnel-settings-store"
import type { FunnelClock } from "@/modules/time/funnel-clock"

type Props = {
  /** Settings persistence (channels / repositories / profiles). Defaults to a FunnelSettingsStore rooted at `dir`. */
  store?: FunnelSettingsReader
  /** Filesystem boundary. Replace with MemoryFunnelFileSystem to sandbox all disk I/O. */
  fs?: FunnelFileSystem
  /** Process runner used by gateway / claude / gh listener. Replace with MemoryFunnelProcessRunner for tests. */
  process?: FunnelProcessRunner
  /** Logger flowed into every facet. Replace with MemoryFunnelLogger or NoopFunnelLogger to silence/inspect. */
  logger?: FunnelLogger
  /** Clock used by schedule listener, gh poll watermarks, and gateway timeouts. */
  clock?: FunnelClock
  /** ID generator for schedule entry ids. Use MemoryFunnelIdGenerator for deterministic tests. */
  idGenerator?: FunnelIdGenerator
  /** Funnel home directory (settings.json + connectors/<type>/). Defaults to ~/.funnel. */
  dir?: string
  /** Temp / runtime directory (gateway logs and PID adjacent files). Defaults to /tmp/funnel. */
  tmpDir?: string
  /** Pre-built connector stores. Useful when sharing stores between multiple Funnel instances. */
  connectorStores?: ConnectorStoresBundle
}

/**
 * Facade exposing every funnel facet as a getter.
 *
 * The same `Funnel` is used by the CLI, the TUI, and as a programmable library.
 * All side-effecting boundaries (filesystem, process, logger, clock, id, paths) are
 * injectable via `Props` — passing memory implementations gives a fully sandboxed
 * Funnel that touches no real disk, processes, or wall-clock time.
 *
 * @example
 * ```ts
 * const funnel = new Funnel({})
 * funnel.connectors.add({ type: "slack", name: "ops", botToken, appToken })
 * funnel.channels.add({ name: "inbox", connectors: ["ops"] })
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

  /** Per-type connector stores (slack / gh / discord / schedule), all DI'd from Props. */
  get stores(): ConnectorStoresBundle {
    return (
      this.props.connectorStores ??
      createConnectorStores({
        fs: this.props.fs,
        process: this.props.process,
        logger: this.props.logger,
        clock: this.props.clock,
        idGenerator: this.props.idGenerator,
        dir: this.props.dir,
      })
    )
  }

  /** Connector CRUD + per-type call/listener APIs. Wired with channels in a forward-const closure. */
  get connectors(): FunnelConnectors {
    return this.wirePair().connectors
  }

  /** Channel CRUD + connector attach/detach. Wired with connectors and profiles via DI. */
  get channels(): FunnelChannels {
    return this.wirePair().channels
  }

  /** Schedule connector entry CRUD (cron lines). */
  get schedule(): FunnelSchedule {
    return new FunnelSchedule({ store: this.stores.schedule })
  }

  /** Launch profiles (named presets for `fnl claude`). */
  get profiles(): FunnelProfiles {
    return new FunnelProfiles({ store: this.store })
  }

  /** Repository registry; writes the funnel MCP entry into each repo's .mcp.json. */
  get repositories(): FunnelRepositories {
    return new FunnelRepositories({ store: this.store, mcp: this.mcp })
  }

  /** Launch Claude Code with a channel injected via env, MCP installed, gateway ensured. */
  get claude(): FunnelClaude {
    return new FunnelClaude({
      channels: this.channels,
      repositories: this.repositories,
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

  /**
   * In-process gateway server. Unlike `gateway.start()` (which spawns a daemon),
   * this returns a class that runs `Bun.serve` + listeners inside the current process —
   * useful for tests, embedding, or custom hosts.
   */
  gatewayServer(
    options: { port?: number; logDir?: string; killCompetingSlack?: boolean } = {},
  ): FunnelGatewayServer {
    return new FunnelGatewayServer({
      connectors: this.connectors,
      settings: this.store,
      port: options.port,
      logDir: options.logDir,
      fs: this.props.fs,
      process: this.props.process,
      clock: this.props.clock,
      logger: this.props.logger,
      killCompetingSlack: options.killCompetingSlack,
    })
  }

  /** funnel MCP installer (writes/removes `.mcp.json` entries in target repos). */
  get mcp(): FunnelMcp {
    return new FunnelMcp({ fs: this.props.fs })
  }

  private wirePair(): { channels: FunnelChannels; connectors: FunnelConnectors } {
    const stores = this.stores
    const profiles = this.profiles
    const channels: FunnelChannels = new FunnelChannels({
      store: this.store,
      connectorChecker: { has: (name) => connectors.has(name) },
      profileChecker: profiles,
      profileRefUpdater: profiles,
    })
    const connectors: FunnelConnectors = new FunnelConnectors({
      ...stores,
      refUpdater: channels,
    })
    return { channels, connectors }
  }
}
