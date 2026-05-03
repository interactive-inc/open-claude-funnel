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
import type { FunnelClock } from "@/modules/time/funnel-clock"

type Props = {
  store: FunnelSettingsReader
  fs?: FunnelFileSystem
  process?: FunnelProcessRunner
  logger?: FunnelLogger
  clock?: FunnelClock
  idGenerator?: FunnelIdGenerator
  dir?: string
  tmpDir?: string
  connectorStores?: ConnectorStoresBundle
}

export class Funnel {
  constructor(private readonly props: Props) {
    Object.freeze(this)
  }

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

  get connectors(): FunnelConnectors {
    const stores = this.stores
    const profiles = this.profiles
    const channels: FunnelChannels = new FunnelChannels({
      store: this.props.store,
      connectorChecker: { has: (name) => connectors.has(name) },
      profileChecker: profiles,
      profileRefUpdater: profiles,
    })
    const connectors: FunnelConnectors = new FunnelConnectors({
      ...stores,
      refUpdater: channels,
    })
    return connectors
  }

  get channels(): FunnelChannels {
    const stores = this.stores
    const profiles = this.profiles
    const channels: FunnelChannels = new FunnelChannels({
      store: this.props.store,
      connectorChecker: { has: (name) => connectors.has(name) },
      profileChecker: profiles,
      profileRefUpdater: profiles,
    })
    const connectors: FunnelConnectors = new FunnelConnectors({
      ...stores,
      refUpdater: channels,
    })
    return channels
  }

  get schedule(): FunnelSchedule {
    return new FunnelSchedule({ store: this.stores.schedule })
  }

  get profiles(): FunnelProfiles {
    return new FunnelProfiles({ store: this.props.store })
  }

  get repositories(): FunnelRepositories {
    return new FunnelRepositories({ store: this.props.store, mcp: this.mcp })
  }

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

  get gateway(): FunnelGateway {
    return new FunnelGateway({
      fs: this.props.fs,
      process: this.props.process,
      clock: this.props.clock,
      dir: this.props.dir,
      tmpDir: this.props.tmpDir,
    })
  }

  gatewayServer(options: { port?: number; logDir?: string; killCompetingSlack?: boolean } = {}): FunnelGatewayServer {
    return new FunnelGatewayServer({
      connectors: this.connectors,
      settings: this.props.store,
      port: options.port,
      logDir: options.logDir,
      fs: this.props.fs,
      process: this.props.process,
      clock: this.props.clock,
      logger: this.props.logger,
      killCompetingSlack: options.killCompetingSlack,
    })
  }

  get mcp(): FunnelMcp {
    return new FunnelMcp({ fs: this.props.fs })
  }
}
