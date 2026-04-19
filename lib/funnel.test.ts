import { describe, expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelClaude } from "@/modules/claude/funnel-claude"
import { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
import { FunnelGateway } from "@/modules/gateway/funnel-gateway"
import { FunnelMcp } from "@/modules/mcp/funnel-mcp"
import { FunnelProfiles } from "@/modules/profiles/funnel-profiles"
import { FunnelRepositories } from "@/modules/repos/funnel-repositories"
import { MockFunnelSettingsReader } from "@/modules/settings/mock-funnel-settings-reader"

describe("Funnel", () => {
  const store = new MockFunnelSettingsReader()
  const funnel = new Funnel({ store })

  test("getters return each service", () => {
    expect(funnel.connectors).toBeInstanceOf(FunnelConnectors)
    expect(funnel.channels).toBeInstanceOf(FunnelChannels)
    expect(funnel.profiles).toBeInstanceOf(FunnelProfiles)
    expect(funnel.repositories).toBeInstanceOf(FunnelRepositories)
    expect(funnel.claude).toBeInstanceOf(FunnelClaude)
    expect(funnel.gateway).toBeInstanceOf(FunnelGateway)
    expect(funnel.mcp).toBeInstanceOf(FunnelMcp)
  })

  test("getters return a fresh instance each time (not memoized)", () => {
    expect(funnel.connectors).not.toBe(funnel.connectors)
  })
})
