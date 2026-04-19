import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"
import { FunnelSettingsStore } from "@/modules/settings/funnel-settings-store"
import { createSettings } from "@/modules/settings/mock-funnel-settings-reader"

const path = "/fake/settings.json"

describe("FunnelSettingsStore", () => {
  test("returns empty settings when file is missing", () => {
    const store = new FunnelSettingsStore({ fs: new MemoryFunnelFileSystem(), path })

    expect(store.read()).toEqual(createSettings())
  })

  test("write → read round trip", () => {
    const fs = new MemoryFunnelFileSystem()
    const store = new FunnelSettingsStore({ fs, path })

    store.write(
      createSettings({
        connectors: [{ type: "slack", name: "s", botToken: "xoxb-a", appToken: "xapp-a" }],
        channels: [{ name: "inbox", connectors: ["s"] }],
      }),
    )

    const restored = store.read()

    expect(restored.connectors).toHaveLength(1)
    expect(restored.channels[0]?.name).toBe("inbox")
  })

  test("write creates the parent directory", () => {
    const fs = new MemoryFunnelFileSystem()
    const store = new FunnelSettingsStore({ fs, path })

    store.write(createSettings())

    expect(fs.existsSync(path)).toBe(true)
  })

  test("invalid JSON throws", () => {
    const fs = new MemoryFunnelFileSystem({ files: { [path]: "{ broken" } })
    const store = new FunnelSettingsStore({ fs, path })

    expect(() => store.read()).toThrow()
  })

  test("schema violation throws with 'invalid settings.json'", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        [path]: JSON.stringify({
          connectors: [{ type: "slack", name: "x", botToken: "wrong", appToken: "also-wrong" }],
          channels: [],
          repositories: [],
          agents: [],
        }),
      },
    })
    const store = new FunnelSettingsStore({ fs, path })

    expect(() => store.read()).toThrow(/invalid settings/)
  })
})
