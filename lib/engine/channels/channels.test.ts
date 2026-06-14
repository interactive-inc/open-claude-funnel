import { describe, expect, test } from "vitest"
import { z } from "zod"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { discordConnector } from "@/engine/connectors/discord-connector"
import { ghConnector } from "@/engine/connectors/gh-connector"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { scheduleEntrySchema } from "@/engine/connectors/schedule-connector-schema"
import { slackConnector } from "@/engine/connectors/slack-connector"
import { slackConnectorSchema } from "@/engine/connectors/slack-connector-schema"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

const profileChecker = { hasChannelRef: () => false }

const buildRegistry = (fs: MemoryFunnelFileSystem): FunnelConnectorRegistry =>
  new FunnelConnectorRegistry({
    descriptors: [slackConnector(), ghConnector(), discordConnector(), scheduleConnector()],
    fs,
    process: new MemoryFunnelProcessRunner(),
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
  })

const buildChannels = (): FunnelChannels => {
  const fs = new MemoryFunnelFileSystem()

  return new FunnelChannels({
    store: new MockFunnelSettingsReader(),
    registry: buildRegistry(fs),
    profileChecker,
    clock: new MemoryFunnelClock(),
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "id" }),
  })
}

const listEntries = (channels: FunnelChannels, connectorName: string) =>
  z.array(scheduleEntrySchema).parse(channels.connectorOp("ops", connectorName, "listEntries", undefined))

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

  test("schedule entry CRUD runs through connectorOp on the connector", () => {
    const channels = buildChannels()
    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "schedule", name: "cron" })

    const entry = scheduleEntrySchema.parse(
      channels.connectorOp("ops", "cron", "addEntry", { cron: "* * * * *", prompt: "go" }),
    )

    expect(listEntries(channels, "cron")).toHaveLength(1)

    channels.connectorOp("ops", "cron", "removeEntry", { id: entry.id })

    expect(listEntries(channels, "cron")).toHaveLength(0)
  })

  test("updateConnector rebuilds a slack token slot, dropping the stale literal on switch to env ref", () => {
    const channels = buildChannels()
    channels.add({ name: "ops" })
    channels.addConnector("ops", {
      type: "slack",
      name: "main",
      botToken: "xoxb-1",
      appToken: "xapp-1",
    })

    channels.updateSlackConnector("ops", "main", { botTokenEnv: "SLACK_BOT" })

    const updated = slackConnectorSchema.parse(channels.getConnector("ops", "main"))

    expect(updated.botTokenEnv).toBe("SLACK_BOT")
    expect(updated.botToken).toBeUndefined()
    // the untouched app slot is carried over unchanged
    expect(updated.appToken).toBe("xapp-1")
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
    const fs = new MemoryFunnelFileSystem()
    const referencingChecker = { hasChannelRef: (id: string) => id === "id-1" }
    const channels = new FunnelChannels({
      store: new MockFunnelSettingsReader(),
      registry: buildRegistry(fs),
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
