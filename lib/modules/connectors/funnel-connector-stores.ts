import { FunnelDiscordStore } from "@/modules/connectors/funnel-discord-store"
import { FunnelGhStore } from "@/modules/connectors/funnel-gh-store"
import { FunnelScheduleStore } from "@/modules/connectors/funnel-schedule-store"
import { FunnelSlackStore } from "@/modules/connectors/funnel-slack-store"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"

export type ConnectorStoresBundle = {
  slack: FunnelSlackStore
  gh: FunnelGhStore
  discord: FunnelDiscordStore
  schedule: FunnelScheduleStore
}

type Deps = {
  fs?: FunnelFileSystem
  dir?: string
}

export const createConnectorStores = (deps: Deps = {}): ConnectorStoresBundle => ({
  slack: new FunnelSlackStore(deps),
  gh: new FunnelGhStore(deps),
  discord: new FunnelDiscordStore(deps),
  schedule: new FunnelScheduleStore(deps),
})
