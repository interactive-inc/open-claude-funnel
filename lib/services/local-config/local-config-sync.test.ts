import { describe, expect, test } from "vitest"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { discordConnector } from "@/engine/connectors/discord-connector"
import { ghConnector } from "@/engine/connectors/gh-connector"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { slackConnector } from "@/engine/connectors/slack-connector"
import { FunnelChannels } from "@/engine/channels/channels"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { FunnelLocalConfigSync } from "@/services/local-config/local-config-sync"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { MemoryFunnelTokenPrompter } from "@/engine/token-prompter/memory-token-prompter"

const buildSync = (opts: { answers?: Record<string, string> } = {}) => {
  const fs = new MemoryFunnelFileSystem({})
  const store = new MockFunnelSettingsReader()
  const registry = new FunnelConnectorRegistry({
    descriptors: [slackConnector(), ghConnector(), discordConnector(), scheduleConnector()],
    fs,
    process: new MemoryFunnelProcessRunner(),
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
  })
  const channels = new FunnelChannels({
    store,
    registry,
    profileChecker: { hasChannelRef: () => false },
    clock: new MemoryFunnelClock(),
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "ch" }),
  })
  const prompter = new MemoryFunnelTokenPrompter({ answers: opts.answers })
  const sync = new FunnelLocalConfigSync({ channels, prompter })

  return { sync, channels, prompter }
}

describe("FunnelLocalConfigSync", () => {
  test("creates the channel when it does not exist", async () => {
    const { sync, channels } = buildSync()

    await sync.ensure({ name: "ops" })

    expect(channels.get("ops")).toMatchObject({ name: "ops" })
  })

  test("prompts for absent tokens and persists the answer", async () => {
    const { sync, channels, prompter } = buildSync({
      answers: {
        "my-slack.botToken": "xoxb-prompted",
        "my-slack.appToken": "xapp-prompted",
      },
    })

    await sync.ensure({
      name: "ops",
      connectors: [{ type: "slack", name: "my-slack" }],
    })

    expect(prompter.asked).toEqual(["my-slack.botToken", "my-slack.appToken"])
    expect(channels.getConnector("ops", "my-slack")).toMatchObject({
      botToken: "xoxb-prompted",
      appToken: "xapp-prompted",
    })
  })

  test("does not re-prompt when the connector already has tokens", async () => {
    const { sync, channels, prompter } = buildSync({
      answers: { "my-slack.botToken": "ignored", "my-slack.appToken": "ignored" },
    })

    channels.add({ name: "ops" })
    channels.addConnector("ops", {
      type: "slack",
      name: "my-slack",
      botToken: "xoxb-existing",
      appToken: "xapp-existing",
    })

    await sync.ensure({
      name: "ops",
      connectors: [{ type: "slack", name: "my-slack" }],
    })

    expect(prompter.asked).toEqual([])
    expect(channels.getConnector("ops", "my-slack")).toMatchObject({
      botToken: "xoxb-existing",
      appToken: "xapp-existing",
    })
  })

  test("carries over an existing env-var reference without prompting", async () => {
    const { sync, channels, prompter } = buildSync({
      answers: { "my-slack.botToken": "ignored", "my-slack.appToken": "ignored" },
    })

    channels.add({ name: "ops" })
    channels.addConnector("ops", {
      type: "slack",
      name: "my-slack",
      botTokenEnv: "SLACK_BOT_TOKEN",
      appTokenEnv: "SLACK_APP_TOKEN",
    })

    await sync.ensure({
      name: "ops",
      connectors: [{ type: "slack", name: "my-slack" }],
    })

    expect(prompter.asked).toEqual([])

    const connector = channels.getConnector("ops", "my-slack")

    expect(connector).toMatchObject({
      botTokenEnv: "SLACK_BOT_TOKEN",
      appTokenEnv: "SLACK_APP_TOKEN",
    })
    expect(connector).not.toHaveProperty("botToken")
  })

  test("throws when an existing connector has a conflicting type", async () => {
    const { sync, channels } = buildSync()

    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "discord", name: "shared", botToken: "abc1234567" })

    await expect(
      sync.ensure({
        name: "ops",
        connectors: [{ type: "slack", name: "shared" }],
      }),
    ).rejects.toThrow(/discord/)
  })

  test("creates a schedule connector without entries", async () => {
    const { sync, channels } = buildSync()

    await sync.ensure({ name: "ops", connectors: [{ type: "schedule", name: "daily" }] })

    expect(channels.getConnector("ops", "daily")).toMatchObject({
      type: "schedule",
      entries: [],
    })
  })

  test("matches slack connectors by name: a renamed spec drops the old and adds the new", async () => {
    const { sync, channels } = buildSync({
      answers: { "new-name.botToken": "xoxb-new", "new-name.appToken": "xapp-new" },
    })

    channels.add({ name: "ops" })
    channels.addConnector("ops", {
      type: "slack",
      name: "old-name",
      botToken: "xoxb-shared",
      appToken: "xapp-shared",
    })

    await sync.ensure({
      name: "ops",
      connectors: [{ type: "slack", name: "new-name" }],
    })

    // Connectors are reconciled by name: the undeclared old connector is removed
    // and the new one is added, prompting for its tokens.
    expect(channels.getConnector("ops", "old-name")).toBeNull()
    expect(channels.getConnector("ops", "new-name")).toMatchObject({
      type: "slack",
      botToken: "xoxb-new",
      appToken: "xapp-new",
    })
  })

  test("matches discord connectors by name: a renamed spec drops the old and adds the new", async () => {
    const { sync, channels } = buildSync({ answers: { "new-name.botToken": "klmnopqrst" } })

    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "discord", name: "old-name", botToken: "abcdefghij" })

    await sync.ensure({
      name: "ops",
      connectors: [{ type: "discord", name: "new-name" }],
    })

    expect(channels.getConnector("ops", "old-name")).toBeNull()
    expect(channels.getConnector("ops", "new-name")).toMatchObject({
      type: "discord",
      botToken: "klmnopqrst",
    })
  })

  test("removes connectors not declared in the spec when connectors[] is present", async () => {
    const { sync, channels } = buildSync()

    channels.add({ name: "ops" })
    channels.addConnector("ops", {
      type: "slack",
      name: "kept",
      botToken: "xoxb-keep",
      appToken: "xapp-keep",
    })
    channels.addConnector("ops", { type: "schedule", name: "extra" })

    await sync.ensure({
      name: "ops",
      connectors: [{ type: "slack", name: "kept" }],
    })

    expect(channels.getConnector("ops", "kept")).not.toBeNull()
    expect(channels.getConnector("ops", "extra")).toBeNull()
  })

  test("leaves existing connectors alone when connectors[] is absent", async () => {
    const { sync, channels } = buildSync()

    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "schedule", name: "extra" })

    await sync.ensure({ name: "ops" })

    expect(channels.getConnector("ops", "extra")).not.toBeNull()
  })

  test("reports a freshly added connector as changed", async () => {
    const { sync } = buildSync({
      answers: { "my-slack.botToken": "xoxb-x", "my-slack.appToken": "xapp-x" },
    })

    const result = await sync.ensure({
      name: "ops",
      connectors: [{ type: "slack", name: "my-slack" }],
    })

    expect(result.touched).toEqual([{ name: "my-slack", changed: true }])
    expect(result.removed).toEqual([])
  })

  test("reports an unchanged connector as not changed", async () => {
    const { sync, channels } = buildSync()

    channels.add({ name: "ops" })
    channels.addConnector("ops", {
      type: "slack",
      name: "my-slack",
      botToken: "xoxb-x",
      appToken: "xapp-x",
    })

    const result = await sync.ensure({
      name: "ops",
      connectors: [{ type: "slack", name: "my-slack" }],
    })

    expect(result.touched).toEqual([{ name: "my-slack", changed: false }])
  })

  test("reports stale connectors in removed", async () => {
    const { sync, channels } = buildSync()

    channels.add({ name: "ops" })
    channels.addConnector("ops", {
      type: "slack",
      name: "kept",
      botToken: "xoxb-k",
      appToken: "xapp-k",
    })
    channels.addConnector("ops", { type: "schedule", name: "extra" })

    const result = await sync.ensure({
      name: "ops",
      connectors: [{ type: "slack", name: "kept" }],
    })

    expect(result.removed).toEqual(["extra"])
  })
})
