import { describe, expect, test } from "bun:test"
import { createConnectorStores } from "@/modules/connectors/funnel-connector-stores"
import { migrateLegacyConnectors } from "@/modules/connectors/migrate-legacy-connectors"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"

const seed = (fs: MemoryFunnelFileSystem, connectors: unknown[]) => {
  fs.writeFileSync(
    "/fake/settings.json",
    `${JSON.stringify({ connectors, channels: [], repositories: [], profiles: [] }, null, 2)}\n`,
  )
}

describe("migrateLegacyConnectors", () => {
  test("moves legacy slack/gh/discord entries into per-type stores", () => {
    const fs = new MemoryFunnelFileSystem()
    seed(fs, [
      { type: "slack", name: "s", botToken: "xoxb-a", appToken: "xapp-a" },
      { type: "gh", name: "g", pollInterval: 30 },
      { type: "discord", name: "d", botToken: "a".repeat(50) },
    ])
    const stores = createConnectorStores({ fs, dir: "/fake" })

    const count = migrateLegacyConnectors({ stores, fs, dir: "/fake" })

    expect(count).toBe(3)
    expect(fs.existsSync("/fake/connectors/slack/s.json")).toBe(true)
    expect(fs.existsSync("/fake/connectors/gh/g.json")).toBe(true)
    expect(fs.existsSync("/fake/connectors/discord/d.json")).toBe(true)

    const settings = JSON.parse(fs.readFileSync("/fake/settings.json")) as Record<string, unknown>
    expect(settings.connectors).toBeUndefined()
  })

  test("no-op when no connectors field", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/fake/settings.json": JSON.stringify({ channels: [], repositories: [], profiles: [] }),
      },
    })
    const stores = createConnectorStores({ fs, dir: "/fake" })

    expect(migrateLegacyConnectors({ stores, fs, dir: "/fake" })).toBe(0)
  })

  test("skips already-migrated connectors", () => {
    const fs = new MemoryFunnelFileSystem()
    seed(fs, [{ type: "slack", name: "s", botToken: "xoxb-a", appToken: "xapp-a" }])
    const stores = createConnectorStores({ fs, dir: "/fake" })

    stores.slack.add({
      type: "slack",
      name: "s",
      botToken: "xoxb-existing",
      appToken: "xapp-existing",
    })

    const count = migrateLegacyConnectors({ stores, fs, dir: "/fake" })
    expect(count).toBe(0)
  })
})
