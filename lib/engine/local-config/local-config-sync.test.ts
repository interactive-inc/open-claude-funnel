import { describe, expect, test } from "bun:test"
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

    await sync.ensure({ name: "ops" }, "/repo")

    expect(channels.get("ops")).toMatchObject({ name: "ops" })
  })

  test("stores env: { ... } references by name, never the resolved secret", async () => {
    const { sync, channels } = buildSync({
      env: { SLACK_BOT_TOKEN: "xoxb-fromenv", SLACK_APP_TOKEN: "xapp-fromenv" },
    })

    await sync.ensure(
      {
        name: "ops",
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

    const connector = channels.getConnector("ops", "my-slack")

    // The reference name is stored; the secret stays in the environment and
    // never lands in settings.
    expect(connector).toMatchObject({
      type: "slack",
      botTokenEnv: "SLACK_BOT_TOKEN",
      appTokenEnv: "SLACK_APP_TOKEN",
    })
    expect(connector).not.toHaveProperty("botToken")
    expect(connector).not.toHaveProperty("appToken")
  })

  test("accepts an env reference backed only by .env.local (still stored by name)", async () => {
    const { sync, channels } = buildSync({
      files: {
        "/repo/.env.local": "SLACK_BOT_TOKEN=xoxb-fromfile\nSLACK_APP_TOKEN=xapp-fromfile\n",
      },
    })

    await sync.ensure(
      {
        name: "ops",
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

    const connector = channels.getConnector("ops", "my-slack")

    expect(connector).toMatchObject({
      botTokenEnv: "SLACK_BOT_TOKEN",
      appTokenEnv: "SLACK_APP_TOKEN",
    })
    expect(connector).not.toHaveProperty("botToken")
  })

  test("uses a literal value as-is", async () => {
    const { sync, channels } = buildSync()

    await sync.ensure(
      {
        name: "ops",
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
          name: "ops",
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
          name: "ops",
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
        name: "ops",
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
        name: "ops",
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
        name: "ops",
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

    // Switching a connector from a literal token to an env reference replaces
    // the slot: the reference name is stored and the stale literal is dropped.
    const connector = channels.getConnector("ops", "my-slack")

    expect(connector).toMatchObject({
      botTokenEnv: "SLACK_BOT_TOKEN",
      appTokenEnv: "SLACK_APP_TOKEN",
    })
    expect(connector).not.toHaveProperty("botToken")
    expect(connector).not.toHaveProperty("appToken")
  })

  test("throws when an existing connector has a conflicting type", async () => {
    const { sync, channels } = buildSync()

    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "discord", name: "shared", botToken: "abc1234567" })

    await expect(
      sync.ensure(
        {
          name: "ops",
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
      { name: "ops", connectors: [{ type: "schedule", name: "daily" }] },
      "/repo",
    )

    expect(channels.getConnector("ops", "daily")).toMatchObject({
      type: "schedule",
      entries: [],
    })
  })

  test("matches slack connectors by name: a renamed spec drops the old and adds the new", async () => {
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
        name: "ops",
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

    // Connectors are reconciled by name. Token-based rename is gone: with env
    // references the secret is not in settings to match on, so a name change is
    // a remove of the undeclared old connector and an add of the new one.
    expect(channels.getConnector("ops", "old-name")).toBeNull()
    expect(channels.getConnector("ops", "new-name")).toMatchObject({
      type: "slack",
      botTokenEnv: "SLACK_BOT_TOKEN",
      appTokenEnv: "SLACK_APP_TOKEN",
    })
  })

  test("matches discord connectors by name: a renamed spec drops the old and adds the new", async () => {
    const { sync, channels } = buildSync({ env: { DISCORD_TOKEN: "abcdefghij" } })

    channels.add({ name: "ops" })
    channels.addConnector("ops", { type: "discord", name: "old-name", botToken: "abcdefghij" })

    await sync.ensure(
      {
        name: "ops",
        connectors: [
          { type: "discord", name: "new-name", env: { botToken: "DISCORD_TOKEN" } },
        ],
      },
      "/repo",
    )

    expect(channels.getConnector("ops", "old-name")).toBeNull()
    expect(channels.getConnector("ops", "new-name")).toMatchObject({
      type: "discord",
      botTokenEnv: "DISCORD_TOKEN",
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
        name: "ops",
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

    await sync.ensure({ name: "ops" }, "/repo")

    expect(channels.getConnector("ops", "extra")).not.toBeNull()
  })

  test("reports a freshly added connector as changed", async () => {
    const { sync } = buildSync()

    const result = await sync.ensure(
      {
        name: "ops",
        connectors: [
          { type: "slack", name: "my-slack", botToken: "xoxb-x", appToken: "xapp-x" },
        ],
      },
      "/repo",
    )

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

    const result = await sync.ensure(
      {
        name: "ops",
        connectors: [
          { type: "slack", name: "my-slack", botToken: "xoxb-x", appToken: "xapp-x" },
        ],
      },
      "/repo",
    )

    expect(result.touched).toEqual([{ name: "my-slack", changed: false }])
  })

  test("reports a token-updated connector as changed", async () => {
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

    const result = await sync.ensure(
      {
        name: "ops",
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

    expect(result.touched).toEqual([{ name: "my-slack", changed: true }])
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

    const result = await sync.ensure(
      {
        name: "ops",
        connectors: [
          { type: "slack", name: "kept", botToken: "xoxb-k", appToken: "xapp-k" },
        ],
      },
      "/repo",
    )

    expect(result.removed).toEqual(["extra"])
  })
})
