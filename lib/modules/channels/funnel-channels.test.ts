import { describe, expect, test } from "bun:test"
import { FunnelChannels } from "@/modules/channels/funnel-channels"
import { MockFunnelSettingsReader } from "@/modules/settings/mock-funnel-settings-reader"

const makeService = () => {
  const store = new MockFunnelSettingsReader({
    connectors: [{ type: "slack", name: "slack-a", botToken: "xoxb", appToken: "xapp" }],
    channels: [],
    repositories: [],
    profiles: [],
  })
  return { store, service: new FunnelChannels({ store }) }
}

describe("FunnelChannels", () => {
  test("add / get", () => {
    const { service } = makeService()
    service.add({ name: "inbox", connectors: [] })
    expect(service.get("inbox")?.connectors).toEqual([])
  })

  test("add with an unknown connector fails", () => {
    const { service } = makeService()
    expect(() => service.add({ name: "inbox", connectors: ["missing"] })).toThrow(/not found/)
  })

  test("attachConnector / detachConnector", () => {
    const { service } = makeService()
    service.add({ name: "inbox", connectors: [] })
    service.attachConnector("inbox", "slack-a")
    expect(service.get("inbox")?.connectors).toEqual(["slack-a"])

    service.detachConnector("inbox", "slack-a")
    expect(service.get("inbox")?.connectors).toEqual([])
  })

  test("attaching a missing connector fails", () => {
    const { service } = makeService()
    service.add({ name: "inbox", connectors: [] })
    expect(() => service.attachConnector("inbox", "missing")).toThrow(/not found/)
  })

  test("rename also updates profile channel references", () => {
    const { service, store } = makeService()
    service.add({ name: "inbox", connectors: [] })
    const settings = store.read()
    settings.profiles.push({ name: "cto", channel: "inbox" })
    store.write(settings)

    service.rename("inbox", "inbox2")

    expect(store.read().profiles[0]?.channel).toBe("inbox2")
  })

  test("cannot remove a channel referenced by a profile", () => {
    const { service, store } = makeService()
    service.add({ name: "inbox", connectors: [] })
    const settings = store.read()
    settings.profiles.push({ name: "cto", channel: "inbox" })
    store.write(settings)

    expect(() => service.remove("inbox")).toThrow(/referenced by a profile/)
  })
})
