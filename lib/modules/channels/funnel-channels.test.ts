import { describe, expect, test } from "bun:test"
import { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
import { createConnectorStores } from "@/modules/connectors/funnel-connector-stores"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"
import { MockFunnelSettingsReader } from "@/modules/settings/mock-funnel-settings-reader"

const makeService = () => {
  const store = new MockFunnelSettingsReader({
    channels: [],
    repositories: [],
    profiles: [],
  })
  const fs = new MemoryFunnelFileSystem()
  const stores = createConnectorStores({ fs, dir: "/fake" })

  const service: FunnelChannels = new FunnelChannels({
    store,
    connectorChecker: { has: (name: string) => connectors.has(name) },
  })

  const connectors: FunnelConnectors = new FunnelConnectors({
    ...stores,
    refUpdater: service,
  })

  connectors.add({ type: "slack", name: "slack-a", botToken: "xoxb-a", appToken: "xapp-a" })

  return { store, service, connectors }
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
