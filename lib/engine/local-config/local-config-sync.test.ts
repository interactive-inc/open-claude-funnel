import { describe, expect, test } from "vitest"
import { FunnelConnectorFactory } from "@/connectors/connector-factory"
import { FunnelChannels } from "@/engine/channels/channels"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { FunnelDotenvReader } from "@/engine/local-config/dotenv-reader"
import { FunnelLocalConfigSync } from "@/engine/local-config/local-config-sync"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { MemoryFunnelTokenPrompter } from "@/engine/token-prompter/memory-token-prompter"

const buildSync = (
  opts: {
    files?: Record<string, string>
    env?: NodeJS.ProcessEnv
    answers?: Record<string, string>
  } = {},
) => {
  const fs = new MemoryFunnelFileSystem({ files: opts.files })
  const store = new MockFunnelSettingsReader()
  const factory = new FunnelConnectorFactory({
    fs,
    process: new MemoryFunnelProcessRunner(),
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
  })
  const channels = new FunnelChannels({
    store,
    factory,
    profileChecker: { hasChannelRef: () => false },
    clock: new MemoryFunnelClock(),
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "ch" }),
  })
  const dotenv = new FunnelDotenvReader({ fs })
  const prompter = new MemoryFunnelTokenPrompter({ answers: opts.answers })
  const sync = new FunnelLocalConfigSync({
    channels,
    dotenv,
    prompter,
    env: opts.env ?? {},
  })

  return { sync, channels, prompter }
}

describe("FunnelLocalConfigSync", () => {
  test("creates the channel when it does not exist", async () => {
    const { sync, channels } = buildSync()

    await sync.ensure({ channel: "ops" }, "/repo")

    expect(channels.get("ops")).toMatchObject({ name: "ops" })
  })

  test("resolves env: { ... } references from process env", async () => {
    const { sync, channels } = buildSync({
      env: { SLACK_BOT_TOKEN: "xoxb-fromenv", SLACK_APP_TOKEN: "xapp-fromenv" },
    })

    await sync.ensure(
      {
        channel: "ops",
        connectors: [
          {
            type: "slack",
            name: "my-slack",
            env: { botToken: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
          },
        ],
      },
      "/repo",
    )

    expect(channels.getConnector("ops", "my-slack")).toMatchObject({
      type: "slack",
      botToken: "xoxb-fromenv",
      appToken: "xapp-fromenv",
    })
  })

  test("falls back to .env.local when the env var is unset", async () => {
    const { sync, channels } = buildSync({
      files: {
        "/repo/.env.local": "SLACK_BOT_TOKEN=xoxb-fromfile\nSLACK_APP_TOKEN=xapp-fromfile\n",
      },
    })

    await sync.ensure(
      {
        channel: "ops",
        connectors: [
          {
            type: "slack",
            name: "my-slack",
            env: { botToken: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
          },
        ],
      },
      "/repo",
    )

    expect(channels.getConnector("ops", "my-slack")).toMatchObject({
      botToken: "xoxb-fromfile",
      appToken: "xapp-fromfile",
    })
  })

  test("uses a literal value as-is", async () => {
    const { sync, channels } = buildSync()

    await sync.ensure(
      {
        channel: "ops",
        connectors: [
          {
            type: "slack",
            name: "my-slack",
            botToken: "xoxb-literal",
            appToken: "xapp-literal",
          },
        ],
      },
      "/repo",
    )

    expect(channels.getConnector("ops", "my-slack")).toMatchObject({
      botToken: "xoxb-literal",
      appToken: "xapp-literal",
    })
  })

  test("throws when env var is referenced but not set anywhere", async () => {
    const { sync } = buildSync()

    await expect(
      sync.ensure(
        {
          channel: "ops",
          connectors: [
            {
              type: "slack",
              name: "my-slack",
              env: { botToken: "MISSING_BOT", appToken: "MISSING_APP" },
            },
          ],
        },
        "/repo",
      ),
    ).rejects.toThrow(/MISSING_BOT/)
  })

  test("throws when literal and env are set for the same field", async () => {
    const { sync } = buildSync({ env: { X: "xoxb-x" } })

    await expect(
      sync.ensure(
        {
          channel: "ops",
          connectors: [
            {
              type: "slack",
              name: "my-slack",
              botToken: "xoxb-literal",
              env: { botToken: "X", appToken: "Y" },
            },
          ],
        },
        "/repo",
      ),
    ).rejects.toThrow(/pick one/)
  })

  test("prompts for absent tokens and persists the answer", async () => {
    const { sync, channels, prompter } = buildSync({
      answers: {
        "my-slack.botToken": "xoxb-prompted",
        "my-slack.appToken": "xapp-prompted",
      },
    })

    await sync.ensure(
      {
        channel: "ops",
        connectors: [{ type: "slack", name: "my-slack" }],
      },
      "/repo",
    )

    expect(prompter.asked).toEqual(["my-slack.botToken", "my-slack.appToken"])
    expect(channels.getConnector("ops", "my-slack")).toMatchObject({
      botToken: "xoxb-prompted",
      appToken: "xapp-prompted",
    })
  })

  test("does not re-prompt when the connector already has tokens and spec omits them", async () => {
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

    await sync.ensure(
      {
        channel: "ops",
        connectors: [{ type: "slack", name: "my-slack" }],
      },
      "/repo",
    )

    expect(prompter.asked).toEqual([])
    expect(channels.getConnector("ops", "my-slack")).toMatchObject({
      botToken: "xoxb-existing",
      appToken: "xapp-existing",
    })
  })

  test("updates existing slack connector when spec declares a fresh env token", async () => {
    const { sync, channels } = buildSync({
      env: { SLACK_BOT_TOKEN: "xoxb-new", SLACK_APP_TOKEN: "xapp-new" },
    })

    channels.add({ name: "ops" })
    channels.addConnector("ops", {
      type: "slack",
      name: "my-slack",
      botToken: "xoxb-old",
      appToken: "xapp-old",
    })

    await sync.ensure(
      {
        channel: "ops",
        connectors: [
          {
            type: "slack",
            name: "my-slack",
            env: { botToken: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
          },
        ],
      },
      "/repo",
    )

    expect(channels.getConnector("ops", "my-slack")).toMatchObject({
      botToken: "xoxb-new",
      appToken: "xapp-new",
    })
  })

  test("throws when an existing connector has a conflicting type", async () => {
    const { sync, channels } = buildSync()

    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "discord", name: "shared", botToken: "abc1234567" })

    await expect(
      sync.ensure(
        {
          channel: "ops",
          connectors: [
            { type: "slack", name: "shared", botToken: "xoxb-x", appToken: "xapp-x" },
          ],
        },
        "/repo",
      ),
    ).rejects.toThrow(/discord/)
  })

  test("creates a schedule connector without entries", async () => {
    const { sync, channels } = buildSync()

    await sync.ensure(
      { channel: "ops", connectors: [{ type: "schedule", name: "daily" }] },
      "/repo",
    )

    expect(channels.getConnector("ops", "daily")).toMatchObject({
      type: "schedule",
      entries: [],
    })
  })

  test("renames an existing slack connector when its tokens match the spec under a different name", async () => {
    const { sync, channels } = buildSync({
      env: { SLACK_BOT_TOKEN: "xoxb-shared", SLACK_APP_TOKEN: "xapp-shared" },
    })

    channels.add({ name: "ops" })
    channels.addConnector("ops", {
      type: "slack",
      name: "old-name",
      botToken: "xoxb-shared",
      appToken: "xapp-shared",
    })

    await sync.ensure(
      {
        channel: "ops",
        connectors: [
          {
            type: "slack",
            name: "new-name",
            env: { botToken: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
          },
        ],
      },
      "/repo",
    )

    expect(channels.getConnector("ops", "old-name")).toBeNull()
    expect(channels.getConnector("ops", "new-name")).toMatchObject({
      type: "slack",
      botToken: "xoxb-shared",
      appToken: "xapp-shared",
    })
  })

  test("renames an existing discord connector when its token matches the spec under a different name", async () => {
    const { sync, channels } = buildSync({ env: { DISCORD_TOKEN: "abcdefghij" } })

    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "discord", name: "old-name", botToken: "abcdefghij" })

    await sync.ensure(
      {
        channel: "ops",
        connectors: [
          { type: "discord", name: "new-name", env: { botToken: "DISCORD_TOKEN" } },
        ],
      },
      "/repo",
    )

    expect(channels.getConnector("ops", "old-name")).toBeNull()
    expect(channels.getConnector("ops", "new-name")).toMatchObject({
      type: "discord",
      botToken: "abcdefghij",
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

    await sync.ensure(
      {
        channel: "ops",
        connectors: [
          {
            type: "slack",
            name: "kept",
            botToken: "xoxb-keep",
            appToken: "xapp-keep",
          },
        ],
      },
      "/repo",
    )

    expect(channels.getConnector("ops", "kept")).not.toBeNull()
    expect(channels.getConnector("ops", "extra")).toBeNull()
  })

  test("leaves existing connectors alone when connectors[] is absent", async () => {
    const { sync, channels } = buildSync()

    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "schedule", name: "extra" })

    await sync.ensure({ channel: "ops" }, "/repo")

    expect(channels.getConnector("ops", "extra")).not.toBeNull()
  })
})
