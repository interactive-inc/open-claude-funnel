import { describe, expect, test } from "bun:test"
import { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
import { createConnectorStores } from "@/modules/connectors/funnel-connector-stores"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"
import { MockFunnelSettingsReader } from "@/modules/settings/mock-funnel-settings-reader"

const makeService = () => {
  const store = new MockFunnelSettingsReader()
  const fs = new MemoryFunnelFileSystem()
  const stores = createConnectorStores({ fs, dir: "/fake" })

  const channels: FunnelChannels = new FunnelChannels({
    store,
    connectorChecker: { has: (name: string) => service.has(name) },
  })

  const service: FunnelConnectors = new FunnelConnectors({
    ...stores,
    refUpdater: channels,
  })

  return { store, fs, service, channels }
}

const makeSample = () => ({
  type: "slack" as const,
  name: "slack-a",
  botToken: "xoxb-a",
  appToken: "xapp-a",
})

const expectSlackBotToken = (conn: ReturnType<FunnelConnectors["get"]>, expected: string): void => {
  expect(conn?.type).toBe("slack")
  if (conn?.type === "slack") {
    expect(conn.botToken).toBe(expected)
  }
}

describe("FunnelConnectors", () => {
  test("list is empty by default", () => {
    const { service } = makeService()
    expect(service.list()).toEqual([])
  })

  test("add stores and get returns the entry", () => {
    const { service } = makeService()
    service.add(makeSample())
    expectSlackBotToken(service.get("slack-a"), "xoxb-a")
  })

  test("adding a duplicate name fails", () => {
    const { service } = makeService()
    service.add(makeSample())
    expect(() => service.add(makeSample())).toThrow(/already exists/)
  })

  test("rename also updates channel connector references", () => {
    const { service, store } = makeService()
    service.add(makeSample())
    const settings = store.read()
    settings.channels.push({ name: "inbox", connectors: ["slack-a"] })
    store.write(settings)

    service.rename("slack-a", "slack-b")

    expect(service.get("slack-a")).toBeNull()
    expectSlackBotToken(service.get("slack-b"), "xoxb-a")
    expect(store.read().channels[0]?.connectors).toEqual(["slack-b"])
  })

  test("remove also removes channel connector references", () => {
    const { service, store } = makeService()
    service.add(makeSample())
    const settings = store.read()
    settings.channels.push({ name: "inbox", connectors: ["slack-a", "slack-b"] })
    store.write(settings)

    service.remove("slack-a")

    expect(service.list()).toEqual([])
    expect(store.read().channels[0]?.connectors).toEqual(["slack-b"])
  })

  test("update can change botToken", () => {
    const { service } = makeService()
    service.add(makeSample())
    service.update("slack-a", { botToken: "xoxb-new" })
    expectSlackBotToken(service.get("slack-a"), "xoxb-new")
  })

  test("can add a gh connector", () => {
    const { service } = makeService()
    service.add({ type: "gh", name: "my-gh", pollInterval: 30 })
    const conn = service.get("my-gh")
    expect(conn?.type).toBe("gh")
    if (conn?.type === "gh") {
      expect(conn.pollInterval).toBe(30)
    }
  })

  test("can add a discord connector", () => {
    const { service } = makeService()
    service.add({ type: "discord", name: "my-dc", botToken: "a".repeat(50) })
    expect(service.get("my-dc")?.type).toBe("discord")
  })

  test("renaming an unregistered connector fails", () => {
    const { service } = makeService()
    expect(() => service.rename("missing", "x")).toThrow(/not found/)
  })

  test("update on schedule connector throws", () => {
    const { service } = makeService()
    service.add({ type: "schedule", name: "cron-a", entries: [] })
    expect(() => service.update("cron-a", { botToken: "x" })).toThrow(/no top-level fields/)
  })

  test("call on schedule connector throws", () => {
    const { service } = makeService()
    service.add({ type: "schedule", name: "cron-a", entries: [] })
    expect(service.call("cron-a", { method: "GET", path: "/" })).rejects.toThrow(
      /does not support call/,
    )
  })
})
