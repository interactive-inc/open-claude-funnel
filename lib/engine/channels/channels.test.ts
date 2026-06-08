import { describe, expect, test } from "vitest"
import { FunnelConnectorFactory } from "@/engine/connectors/connector-factory"
import { FunnelChannels } from "@/engine/channels/channels"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

const profileChecker = { hasChannelRef: () => false }

const buildChannels = (): FunnelChannels => {
  const store = new MockFunnelSettingsReader()
  const fs = new MemoryFunnelFileSystem()
  const factory = new FunnelConnectorFactory({
    fs,
    process: new MemoryFunnelProcessRunner(),
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
  })

  return new FunnelChannels({
    store,
    factory,
    profileChecker,
    clock: new MemoryFunnelClock(),
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "id" }),
  })
}

describe("FunnelChannels", () => {
  test("add assigns a stable id and persists the channel", () => {
    const channels = buildChannels()
    const created = channels.add({ name: "inbox" })

    expect(created.id).toBe("id-1")
    expect(created.name).toBe("inbox")
    expect(created.delivery).toBe("fanout")
    expect(channels.list()).toHaveLength(1)
    expect(channels.getById("id-1")?.name).toBe("inbox")
  })

  test("add rejects duplicate names", () => {
    const channels = buildChannels()
    channels.add({ name: "ops" })
    expect(() => channels.add({ name: "ops" })).toThrow(/already exists/)
  })

  test("addConnector nests the connector under the channel with id and timestamps", () => {
    const channels = buildChannels()
    channels.add({ name: "ops" })

    const created = channels.addConnector("ops", {
      type: "slack",
      name: "main",
      botToken: "xoxb-1",
      appToken: "xapp-1",
    })

    expect(created.type).toBe("slack")
    expect(created.id).toBe("id-2")
    expect(created.createdAt).toBeDefined()
    expect(channels.listConnectors("ops")).toHaveLength(1)
  })

  test("addConnector rejects token reuse across channels", () => {
    const channels = buildChannels()
    channels.add({ name: "a" })
    channels.add({ name: "b" })

    channels.addConnector("a", {
      type: "slack",
      name: "main",
      botToken: "xoxb-X",
      appToken: "xapp-X",
    })

    expect(() =>
      channels.addConnector("b", {
        type: "slack",
        name: "alt",
        botToken: "xoxb-X",
        appToken: "xapp-Y",
      }),
    ).toThrow(/token already in use/)
  })

  test("removeConnector drops the entry from its channel", () => {
    const channels = buildChannels()
    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "schedule", name: "cron" })

    channels.removeConnector("ops", "cron")

    expect(channels.listConnectors("ops")).toHaveLength(0)
  })

  test("renameConnector enforces uniqueness inside the channel", () => {
    const channels = buildChannels()
    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "schedule", name: "a" })
    channels.addConnector("ops", { type: "schedule", name: "b" })

    expect(() => channels.renameConnector("ops", "a", "b")).toThrow(/already exists/)
    channels.renameConnector("ops", "a", "c")
    expect(
      channels
        .listConnectors("ops")
        .map((c) => c.name)
        .sort(),
    ).toEqual(["b", "c"])
  })

  test("schedule entry CRUD lives on the connector", () => {
    const channels = buildChannels()
    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "schedule", name: "cron" })

    const entry = channels.addScheduleEntry("ops", "cron", { cron: "* * * * *", prompt: "go" })

    expect(channels.listScheduleEntries("ops", "cron")).toHaveLength(1)

    channels.removeScheduleEntry("ops", "cron", entry.id)

    expect(channels.listScheduleEntries("ops", "cron")).toHaveLength(0)
  })

  test("rename rejects collisions and updates the channel name", () => {
    const channels = buildChannels()
    channels.add({ name: "ops" })
    channels.add({ name: "alt" })

    expect(() => channels.rename("ops", "alt")).toThrow(/already exists/)
    channels.rename("ops", "team")
    expect(channels.get("team")?.name).toBe("team")
  })

  test("remove blocks when a profile references the channel", () => {
    const store = new MockFunnelSettingsReader()
    const fs = new MemoryFunnelFileSystem()
    const factory = new FunnelConnectorFactory({
      fs,
      process: new MemoryFunnelProcessRunner(),
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
    })
    const referencingChecker = { hasChannelRef: (id: string) => id === "id-1" }
    const channels = new FunnelChannels({
      store,
      factory,
      profileChecker: referencingChecker,
      clock: new MemoryFunnelClock(),
      idGenerator: new MemoryFunnelIdGenerator({ prefix: "id" }),
    })

    channels.add({ name: "ops" })
    expect(() => channels.remove("ops")).toThrow(/referenced by a profile/)
  })

  test("listAllConnectors returns flattened channelId/channelName-tagged views", () => {
    const channels = buildChannels()
    channels.add({ name: "ops" })
    channels.add({ name: "alt" })
    channels.addConnector("ops", { type: "schedule", name: "cron" })
    channels.addConnector("alt", { type: "schedule", name: "cron" })

    const all = channels.listAllConnectors()

    expect(all).toHaveLength(2)
    expect(new Set(all.map((c) => c.channelName))).toEqual(new Set(["ops", "alt"]))
  })
})
