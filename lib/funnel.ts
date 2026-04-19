import { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelClaude } from "@/modules/claude/funnel-claude"
import { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
import { FunnelGateway } from "@/modules/gateway/funnel-gateway"
import { FunnelMcp } from "@/modules/mcp/funnel-mcp"
import { FunnelProfiles } from "@/modules/profiles/funnel-profiles"
import { FunnelRepositories } from "@/modules/repos/funnel-repositories"
import { FunnelSettingsReader } from "@/modules/settings/funnel-settings-reader"

type Props = {
  store: FunnelSettingsReader
}

export class Funnel {
  constructor(private readonly props: Props) {
    Object.freeze(this)
  }

  get connectors(): FunnelConnectors {
    return new FunnelConnectors({ store: this.props.store })
  }

  get channels(): FunnelChannels {
    return new FunnelChannels({ store: this.props.store })
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
