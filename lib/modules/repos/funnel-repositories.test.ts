import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"
import { FunnelMcp } from "@/modules/mcp/funnel-mcp"
import { FunnelRepositories } from "@/modules/repos/funnel-repositories"
import { MockFunnelSettingsReader } from "@/modules/settings/mock-funnel-settings-reader"

const makeService = () => {
  const store = new MockFunnelSettingsReader()
  const fs = new MemoryFunnelFileSystem({ dirs: ["/repo"] })
  const mcp = new FunnelMcp({ fs })

  return { store, service: new FunnelRepositories({ store, mcp }), mcp, fs }
}

describe("FunnelRepositories", () => {
  test("add generates .mcp.json", () => {
    const { service, mcp } = makeService()

    service.add({ name: "r", path: "/repo" })

    expect(mcp.findInstalledName("/repo")).toBe("funnel")
  })

  test("cannot remove a repo referenced by a profile", () => {
    const { service, store } = makeService()

    service.add({ name: "r", path: "/repo" })

    const settings = store.read()
    settings.profiles.push({ name: "a", channel: "x", repo: "r" })
    store.write(settings)

    expect(() => service.remove("r")).toThrow(/referenced by a profile/)
  })

  test("rename also updates profile repo references", () => {
    const { service, store } = makeService()

    service.add({ name: "r", path: "/repo" })

    const settings = store.read()
    settings.profiles.push({ name: "a", channel: "x", repo: "r" })
    store.write(settings)

    service.rename("r", "r2")

    expect(store.read().profiles[0]?.repo).toBe("r2")
  })
})
