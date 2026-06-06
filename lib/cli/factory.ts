import { createFactory } from "hono/factory"
import type { Funnel } from "@/funnel"
import type { FunnelClaude } from "@/engine/claude/claude"
import type { FunnelProfiles } from "@/engine/profiles/profiles"
import type { FunnelLocalConfig } from "@/services/local-config/local-config"
import type { FunnelLocalConfigSync } from "@/services/local-config/local-config-sync"

export type Env = {
  Bindings: {
    funnel: Funnel
    claude: FunnelClaude
    profiles: FunnelProfiles
    localConfig: FunnelLocalConfig
    localConfigSync: FunnelLocalConfigSync
  }
}

export const factory = createFactory<Env>()
