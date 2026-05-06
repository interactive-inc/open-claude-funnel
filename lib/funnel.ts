import { join } from "node:path";
import { FunnelChannels } from "@/engine/channels/channels";
import { FunnelClaude } from "@/engine/claude/claude";
import { type ConnectorStoresBundle, createConnectorStores } from "@/connectors/connector-stores";
import { FunnelConnectors } from "@/connectors/connectors";
import type { FunnelFileSystem } from "@/engine/fs/file-system";
import { FunnelGateway } from "@/gateway/gateway";
import { FunnelGatewayServer } from "@/gateway/gateway-server";
import { FunnelGatewayToken } from "@/gateway/gateway-token";
import { FunnelListenersClient } from "@/gateway/listeners-client";
import type { FunnelIdGenerator } from "@/engine/id/id-generator";
import { FunnelLogger } from "@/engine/logger/logger";
import { NodeFunnelLogger } from "@/engine/logger/node-logger";
import { FunnelMcp } from "@/engine/mcp/mcp";
import { FunnelProcessRunner } from "@/engine/process/process-runner";
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner";
import { FunnelProfiles } from "@/engine/profiles/profiles";
import { FunnelRepositories } from "@/engine/repos/repositories";
import { FunnelSchedule } from "@/connectors/schedule";
import { FunnelSettingsReader } from "@/engine/settings/settings-reader";
import { FUNNEL_DIR, FunnelSettingsStore } from "@/engine/settings/settings-store";
import type { FunnelClock } from "@/engine/time/clock";

type Props = {
  /** Settings persistence (channels / repositories / profiles). Defaults to a FunnelSettingsStore rooted at `dir`. */
  store?: FunnelSettingsReader;
  /** Filesystem boundary. Replace with MemoryFunnelFileSystem to sandbox all disk I/O. */
  fs?: FunnelFileSystem;
  /** Process runner used by gateway / claude / gh listener. Replace with MemoryFunnelProcessRunner for tests. */
  process?: FunnelProcessRunner;
  /** Logger flowed into every facet. Replace with MemoryFunnelLogger or NoopFunnelLogger to silence/inspect. */
  logger?: FunnelLogger;
  /** Clock used by schedule listener, gh poll watermarks, and gateway timeouts. */
  clock?: FunnelClock;
  /** ID generator for schedule entry ids. Use MemoryFunnelIdGenerator for deterministic tests. */
  idGenerator?: FunnelIdGenerator;
  /** Funnel home directory (settings.json + connectors/<type>/). Defaults to ~/.funnel. */
  dir?: string;
  /** Temp / runtime directory (gateway logs and PID adjacent files). Defaults to /tmp/funnel. */
  tmpDir?: string;
  /** Pre-built connector stores. Useful when sharing stores between multiple Funnel instances. */
  connectorStores?: ConnectorStoresBundle;
};

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
    Object.freeze(this);
  }

  /** Settings reader. If not injected, a FunnelSettingsStore rooted at `dir` is created. */
  get store(): FunnelSettingsReader {
    return (
      this.props.store ??
      new FunnelSettingsStore({
        path: join(this.props.dir ?? FUNNEL_DIR, "settings.json"),
        fs: this.props.fs,
      })
    );
  }

  /** Process runner boundary. Defaults to NodeFunnelProcessRunner. */
  get process(): FunnelProcessRunner {
    return this.props.process ?? new NodeFunnelProcessRunner();
  }

  /** Logger boundary. Defaults to NodeFunnelLogger. */
  get logger(): FunnelLogger {
    return this.props.logger ?? new NodeFunnelLogger();
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
    );
  }

  /** Connector CRUD + per-type call/listener APIs. Wired with channels in a forward-const closure. */
  get connectors(): FunnelConnectors {
    return this.wirePair().connectors;
  }

  /** Channel CRUD + connector attach/detach. Wired with connectors and profiles via DI. */
  get channels(): FunnelChannels {
    return this.wirePair().channels;
  }

  /** Schedule connector entry CRUD (cron lines). */
  get schedule(): FunnelSchedule {
    return new FunnelSchedule({ store: this.stores.schedule });
  }

  /** Launch profiles (named presets for `fnl claude`). */
  get profiles(): FunnelProfiles {
    return new FunnelProfiles({ store: this.store });
  }

  /** Repository registry; writes the funnel MCP entry into each repo's .mcp.json. */
  get repositories(): FunnelRepositories {
    return new FunnelRepositories({ store: this.store, mcp: this.mcp });
  }

  /** funnel MCP installer (writes/removes `.mcp.json` entries in target repos). */
  get mcp(): FunnelMcp {
    return new FunnelMcp({ fs: this.props.fs });
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
    });
  }

  /** Gateway daemon controller (PID-file, start/stop the separate `bun daemon.ts` process). */
  get gateway(): FunnelGateway {
    return new FunnelGateway({
      fs: this.props.fs,
      process: this.props.process,
      clock: this.props.clock,
      dir: this.props.dir,
      tmpDir: this.props.tmpDir,
    });
  }

  /** Read / generate the daemon's gateway token (mode 0600 file under `dir`). */
  get gatewayToken(): FunnelGatewayToken {
    return new FunnelGatewayToken({ fs: this.props.fs, dir: this.props.dir });
  }

  /**
   * HTTP client for listener operations on the running gateway daemon.
   * Returns `{ state: "offline" }` when the daemon is offline so hot-reload
   * paths stay write-only without parsing strings.
   */
  get listeners(): FunnelListenersClient {
    const gateway = this.gateway;
    const token = this.gatewayToken;

    return new FunnelListenersClient({
      port: gateway.getPort(),
      isDaemonRunning: () => gateway.isRunning(),
      getToken: () => token.read(),
    });
  }

  /**
   * In-process gateway server. Unlike `gateway.start()` (which spawns a daemon),
   * this returns a class that runs `Bun.serve` + listeners inside the current process —
   * useful for tests, embedding, or custom hosts.
   */
  gatewayServer(
    options: {
      port?: number;
      logDir?: string;
      killCompetingSlack?: boolean;
      /** Override the auth token. Defaults to the persisted gateway.token. Pass "" to disable auth (tests). */
      token?: string;
    } = {},
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
      token: options.token ?? this.gatewayToken.ensure(),
    });
  }

  /**
   * Wires the Channels ↔ Connectors cycle.
   *
   * Channels need to ask "does this connector exist?" (ConnectorExistenceChecker)
   * and Connectors need to ask "rename / detach me from any channel that points
   * at me" (ChannelConnectorRefUpdater). Each side only sees the other through a
   * narrow type interface, so there is no module-level cycle.
   *
   * The forward const closure below gives Channels' checker a reference to
   * `connectors` *before* `connectors` is constructed — at construction time the
   * closure is captured but never called; calls only happen later, at which
   * point both objects exist. This is the cheapest way to break the cycle
   * without introducing a builder phase.
   */
  private wirePair(): { channels: FunnelChannels; connectors: FunnelConnectors } {
    const stores = this.stores;
    const profiles = this.profiles;
    const channels: FunnelChannels = new FunnelChannels({
      store: this.store,
      connectorChecker: { has: (name) => connectors.has(name) },
      profileChecker: profiles,
      profileRefUpdater: profiles,
    });
    const connectors: FunnelConnectors = new FunnelConnectors({
      ...stores,
      refUpdater: channels,
    });
    return { channels, connectors };
  }
}
