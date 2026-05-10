import { describe, expect, test } from "vitest"
import { FunnelProfiles } from "@/engine/profiles/profiles"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"

const buildProfiles = (): { profiles: FunnelProfiles; store: MockFunnelSettingsReader } => {
  const store = new MockFunnelSettingsReader({
    channels: [{ id: "ch-1", name: "ops", delivery: "fanout", connectors: [] }],
  })

  return { profiles: new FunnelProfiles({ store }), store }
}

const sampleProfile = {
  name: "default",
  path: "/repo",
  subAgent: "router",
  channelId: "ch-1",
}

describe("FunnelProfiles", () => {
  test("add persists a profile referencing an existing channel id", () => {
    const { profiles } = buildProfiles()
    profiles.add({ ...sampleProfile })
    expect(profiles.list()).toHaveLength(1)
    expect(profiles.get("default")?.channelId).toBe("ch-1")
  })

  test("add rejects duplicate names", () => {
    const { profiles } = buildProfiles()
    profiles.add({ ...sampleProfile })
    expect(() => profiles.add({ ...sampleProfile })).toThrow(/already exists/)
  })

  test("add rejects unknown channel ids", () => {
    const { profiles } = buildProfiles()
    expect(() => profiles.add({ ...sampleProfile, channelId: "ch-missing" })).toThrow(
      /channel id "ch-missing" not found/,
    )
  })

  test("getDefault returns the first entry", () => {
    const { profiles } = buildProfiles()
    profiles.add({ ...sampleProfile, name: "first" })
    profiles.add({ ...sampleProfile, name: "second" })
    expect(profiles.getDefault()?.name).toBe("first")
  })

  test("asDefault moves a named profile to the front", () => {
    const { profiles } = buildProfiles()
    profiles.add({ ...sampleProfile, name: "a" })
    profiles.add({ ...sampleProfile, name: "b" })
    profiles.add({ ...sampleProfile, name: "c" })

    profiles.asDefault("c")

    expect(profiles.list().map((p) => p.name)).toEqual(["c", "a", "b"])
  })

  test("hasChannelRef checks the channel id", () => {
    const { profiles } = buildProfiles()
    profiles.add({ ...sampleProfile })
    expect(profiles.hasChannelRef("ch-1")).toBe(true)
    expect(profiles.hasChannelRef("ch-other")).toBe(false)
  })

  test("update applies allowed field changes", () => {
    const { profiles, store } = buildProfiles()

    store.write({
      version: 1,
      channels: [
        { id: "ch-1", name: "ops", delivery: "fanout", connectors: [] },
        { id: "ch-2", name: "alt", delivery: "fanout", connectors: [] },
      ],
      profiles: [],
    })

    profiles.add({ ...sampleProfile })
    profiles.update("default", { channelId: "ch-2", path: "/other", subAgent: "qa" })

    const updated = profiles.get("default")

    expect(updated?.channelId).toBe("ch-2")
    expect(updated?.path).toBe("/other")
    expect(updated?.subAgent).toBe("qa")
  })

  test("rename rejects collisions and renames otherwise", () => {
    const { profiles } = buildProfiles()
    profiles.add({ ...sampleProfile, name: "a" })
    profiles.add({ ...sampleProfile, name: "b" })

    expect(() => profiles.rename("a", "b")).toThrow(/already exists/)
    profiles.rename("a", "c")

    expect(
      profiles
        .list()
        .map((p) => p.name)
        .sort(),
    ).toEqual(["b", "c"])
  })
})
