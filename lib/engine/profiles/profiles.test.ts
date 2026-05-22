import { describe, expect, test } from "vitest"
import { FunnelProfiles } from "@/engine/profiles/profiles"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"

const channel = (id: string, name: string) => ({
  id,
  name,
  delivery: "fanout" as const,
  connectors: [],
})

const buildProfiles = (): { profiles: FunnelProfiles; store: MockFunnelSettingsReader } => {
  const store = new MockFunnelSettingsReader({
    channels: [channel("ch-1", "ops")],
  })

  return { profiles: new FunnelProfiles({ store }), store }
}

const sampleProfile = {
  name: "default",
  path: "/repo",
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
      channels: [channel("ch-1", "ops"), channel("ch-2", "alt")],
      profiles: [],
    })

    profiles.add({ ...sampleProfile })
    profiles.update("default", { channelId: "ch-2", path: "/other" })

    const updated = profiles.get("default")

    expect(updated?.channelId).toBe("ch-2")
    expect(updated?.path).toBe("/other")
  })

  test("add defaults the launch recipe and update overrides it", () => {
    const { profiles } = buildProfiles()

    profiles.add({ ...sampleProfile })

    const added = profiles.get("default")

    expect(added?.options).toEqual([])
    expect(added?.env).toEqual({})
    expect(added?.resume).toBe(true)

    profiles.update("default", {
      options: ["--agent", "pm"],
      env: { ANTHROPIC_MODEL: "claude-sonnet-4-6" },
      resume: false,
    })

    const updated = profiles.get("default")

    expect(updated?.options).toEqual(["--agent", "pm"])
    expect(updated?.env).toEqual({ ANTHROPIC_MODEL: "claude-sonnet-4-6" })
    expect(updated?.resume).toBe(false)
  })

  test("add persists an explicit launch recipe", () => {
    const { profiles } = buildProfiles()

    profiles.add({
      ...sampleProfile,
      options: ["--brief"],
      env: { FOO: "bar" },
      resume: false,
    })

    const added = profiles.get("default")

    expect(added?.options).toEqual(["--brief"])
    expect(added?.env).toEqual({ FOO: "bar" })
    expect(added?.resume).toBe(false)
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
