import { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelClaude } from "@/modules/claude/funnel-claude"
import {
  type ConnectorStoresBundle,
  createConnectorStores,
} from "@/modules/connectors/funnel-connector-stores"
import { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
import type { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { FunnelGateway } from "@/modules/gateway/funnel-gateway"
import { FunnelMcp } from "@/modules/mcp/funnel-mcp"
import { FunnelProfiles } from "@/modules/profiles/funnel-profiles"
import { FunnelRepositories } from "@/modules/repos/funnel-repositories"
import { FunnelSchedule } from "@/modules/schedule/funnel-schedule"
import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"

type Props = {
  store: FunnelSettingsReader
  fs?: FunnelFileSystem
  dir?: string
  connectorStores?: ConnectorStoresBundle
}

export class Funnel {
  constructor(private readonly props: Props) {
    Object.freeze(this)
  }

  get stores(): ConnectorStoresBundle {
    return (
      this.props.connectorStores ??
      createConnectorStores({ fs: this.props.fs, dir: this.props.dir })
    )
  }

  get connectors(): FunnelConnectors {
    const stores = this.stores
    const channels: FunnelChannels = new FunnelChannels({
      store: this.props.store,
      connectorChecker: { has: (name) => connectors.has(name) },
    })
    const connectors: FunnelConnectors = new FunnelConnectors({
      ...stores,
      refUpdater: channels,
    })
    return connectors
  }

  get channels(): FunnelChannels {
    const stores = this.stores
    const channels: FunnelChannels = new FunnelChannels({
      store: this.props.store,
      connectorChecker: { has: (name) => connectors.has(name) },
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
    })
  }

  get gateway(): FunnelGateway {
    return new FunnelGateway()
  }

  get mcp(): FunnelMcp {
    return new FunnelMcp()
  }
}
