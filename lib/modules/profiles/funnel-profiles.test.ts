import { describe, expect, test } from "bun:test"
import { FunnelProfiles } from "@/modules/profiles/funnel-profiles"
import { MockFunnelSettingsReader } from "@/modules/settings/mock-funnel-settings-reader"

const makeService = () => {
  const store = new MockFunnelSettingsReader({
    connectors: [],
    channels: [{ name: "inbox", connectors: [] }],
    repositories: [{ name: "myapp", path: "/tmp/myapp" }],
    profiles: [],
  })
  return { store, service: new FunnelProfiles({ store }) }
}

describe("FunnelProfiles", () => {
  test("add / get", () => {
    const { service } = makeService()
    service.add({ name: "cto", channel: "inbox" })
    expect(service.get("cto")?.channel).toBe("inbox")
  })

  test("add with unknown channel fails", () => {
    const { service } = makeService()
    expect(() => service.add({ name: "cto", channel: "missing" })).toThrow(
      /channel "missing" not found/,
    )
  })

  test("add with unknown repo fails", () => {
    const { service } = makeService()
    expect(() => service.add({ name: "cto", channel: "inbox", repo: "missing" })).toThrow(
      /repo "missing" not found/,
    )
  })

  test("update can change channel / repo", () => {
    const { service, store } = makeService()
    const settings = store.read()
    settings.channels.push({ name: "other", connectors: [] })
    store.write(settings)

    service.add({ name: "cto", channel: "inbox" })
    service.update("cto", { channel: "other", repo: "myapp" })

    const profile = service.get("cto")
    expect(profile?.channel).toBe("other")
    expect(profile?.repo).toBe("myapp")
  })

  test("update with empty repo string unsets it", () => {
    const { service } = makeService()
    service.add({ name: "cto", channel: "inbox", repo: "myapp" })
    service.update("cto", { repo: "" })
    expect(service.get("cto")?.repo).toBeUndefined()
  })
})
