import { describe, expect, test } from "vitest"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { SETTINGS_VERSION } from "@/engine/settings/settings-schema"
import { FunnelSettingsStore } from "@/engine/settings/settings-store"

const PATH = "/funnel/settings.json"

describe("FunnelSettingsStore", () => {
  test("returns an empty settings object when the file is absent", () => {
    const store = new FunnelSettingsStore({ path: PATH, fs: new MemoryFunnelFileSystem() })

    expect(store.read()).toEqual({
      version: SETTINGS_VERSION,
      channels: [],
      profiles: [],
    })
  })

  test("round-trips a channel with a nested connector", () => {
    const fs = new MemoryFunnelFileSystem()
    const store = new FunnelSettingsStore({ path: PATH, fs })

    store.write({
      version: SETTINGS_VERSION,
      channels: [
        {
          id: "ch-1",
          name: "ops",
          delivery: "fanout",
          connectors: [
            {
              id: "co-1",
              type: "slack",
              name: "main",
              botToken: "xoxb-x",
              appToken: "xapp-x",
            },
          ],
        },
      ],
      profiles: [],
    })

    const loaded = store.read()

    expect(loaded.channels[0]?.connectors[0]?.name).toBe("main")
    expect(loaded.channels[0]?.connectors[0]?.id).toBe("co-1")
  })

  test("rejects legacy connectors-as-strings shape with a guidance message", () => {
    const fs = new MemoryFunnelFileSystem()

    fs.mkdirSync("/funnel", { recursive: true })
    fs.writeFileSync(
      PATH,
      JSON.stringify({
        version: SETTINGS_VERSION,
        channels: [{ name: "ops", connectors: ["legacy-name"], delivery: "fanout" }],
        profiles: [],
      }),
    )

    const store = new FunnelSettingsStore({ path: PATH, fs })

    expect(() => store.read()).toThrow(/legacy settings\.json detected/)
  })

  test("rejects legacy top-level connectors[] shape", () => {
    const fs = new MemoryFunnelFileSystem()

    fs.mkdirSync("/funnel", { recursive: true })
    fs.writeFileSync(
      PATH,
      JSON.stringify({
        version: SETTINGS_VERSION,
        channels: [],
        profiles: [],
        connectors: [{ type: "slack", name: "x" }],
      }),
    )

    const store = new FunnelSettingsStore({ path: PATH, fs })

    expect(() => store.read()).toThrow(/legacy settings\.json detected/)
  })
})
