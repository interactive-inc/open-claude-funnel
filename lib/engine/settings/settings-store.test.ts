import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { SETTINGS_VERSION } from "@/engine/settings/settings-schema"
import { FunnelSettingsStore, resolveFunnelPort } from "@/engine/settings/settings-store"

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
              minify: true,
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

  test("writes settings.json owner-only (0600) since it inlines connector tokens", () => {
    const fs = new MemoryFunnelFileSystem()
    const store = new FunnelSettingsStore({ path: PATH, fs })

    store.write({ version: SETTINGS_VERSION, channels: [], profiles: [] })

    expect(fs.statSync(PATH).mode).toBe(0o600)
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

  test("backfills an id for a profile written before ids existed", () => {
    const fs = new MemoryFunnelFileSystem()

    fs.mkdirSync("/funnel", { recursive: true })
    fs.writeFileSync(
      PATH,
      JSON.stringify({
        version: SETTINGS_VERSION,
        channels: [{ id: "ch-1", name: "ops", delivery: "fanout", connectors: [] }],
        profiles: [{ name: "dev", path: "/repo", channelId: "ch-1" }],
      }),
    )

    const store = new FunnelSettingsStore({
      path: PATH,
      fs,
      idGenerator: new MemoryFunnelIdGenerator({ prefix: "prof" }),
    })

    const loaded = store.read()

    expect(loaded.profiles[0]?.id).toBe("prof-1")
    expect(loaded.profiles[0]?.name).toBe("dev")
  })

  test("persists a backfilled id so repeated reads return the same id", () => {
    const fs = new MemoryFunnelFileSystem()

    fs.mkdirSync("/funnel", { recursive: true })
    fs.writeFileSync(
      PATH,
      JSON.stringify({
        version: SETTINGS_VERSION,
        channels: [{ id: "ch-1", name: "ops", delivery: "fanout", connectors: [] }],
        profiles: [{ name: "dev", path: "/repo", channelId: "ch-1" }],
      }),
    )

    const store = new FunnelSettingsStore({
      path: PATH,
      fs,
      idGenerator: new MemoryFunnelIdGenerator({ prefix: "prof" }),
    })

    const first = store.read().profiles[0]?.id
    const second = store.read().profiles[0]?.id

    // Without persistence the second read re-mints prof-2, and setSessionId
    // (a separate read) could never match the id the launch used.
    expect(first).toBe("prof-1")
    expect(second).toBe("prof-1")
    expect(JSON.parse(fs.readFileSync(PATH)).profiles[0].id).toBe("prof-1")
  })

  test("preserves an existing profile id rather than reassigning it", () => {
    const fs = new MemoryFunnelFileSystem()

    fs.mkdirSync("/funnel", { recursive: true })
    fs.writeFileSync(
      PATH,
      JSON.stringify({
        version: SETTINGS_VERSION,
        channels: [{ id: "ch-1", name: "ops", delivery: "fanout", connectors: [] }],
        profiles: [{ id: "keep-me", name: "dev", path: "/repo", channelId: "ch-1" }],
      }),
    )

    const store = new FunnelSettingsStore({
      path: PATH,
      fs,
      idGenerator: new MemoryFunnelIdGenerator({ prefix: "prof" }),
    })

    expect(store.read().profiles[0]?.id).toBe("keep-me")
  })
})

describe("resolveFunnelPort", () => {
  test("defaults to 9742 and honors FUNNEL_PORT", () => {
    const saved = process.env.FUNNEL_PORT

    delete process.env.FUNNEL_PORT
    expect(resolveFunnelPort()).toBe(9742)

    process.env.FUNNEL_PORT = "9743"
    expect(resolveFunnelPort()).toBe(9743)

    if (saved === undefined) delete process.env.FUNNEL_PORT
    else process.env.FUNNEL_PORT = saved
  })
})
