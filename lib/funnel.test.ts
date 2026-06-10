import { describe, expect, test } from "vitest"
import { Funnel } from "@/funnel"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { MemoryFunnelTokenPrompter } from "@/engine/token-prompter/memory-token-prompter"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"

const buildFunnel = (): Funnel =>
  new Funnel({
    store: new MockFunnelSettingsReader(),
    fs: new MemoryFunnelFileSystem(),
    process: new MemoryFunnelProcessRunner(),
    logger: new NoopFunnelLogger(),
    clock: new MemoryFunnelClock(),
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "id" }),
    tokenPrompter: new MemoryFunnelTokenPrompter(),
  })

describe("Funnel facade", () => {
  test("exposes channels with the channel-scoped connector API wired", () => {
    const funnel = buildFunnel()

    funnel.channels.add({ name: "ops" })
    funnel.channels.addConnector("ops", { type: "schedule", name: "cron" })

    expect(funnel.channels.listAllConnectors()).toHaveLength(1)
  })

  test("profiles see the same store as channels (shared settings)", () => {
    const funnel = buildFunnel()

    const channel = funnel.channels.add({ name: "ops" })

    funnel.profiles.add({
      name: "default",
      path: "/repo",
      channelId: channel.id,
    })

    expect(funnel.profiles.list()).toHaveLength(1)
    expect(funnel.profiles.get("default")?.channelId).toBe(channel.id)
  })

  test("channels.remove refuses while a profile still references the channel", () => {
    const funnel = buildFunnel()
    const channel = funnel.channels.add({ name: "ops" })

    funnel.profiles.add({
      name: "default",
      path: "/repo",
      channelId: channel.id,
    })

    expect(() => funnel.channels.remove("ops")).toThrow("referenced by a profile")

    funnel.profiles.remove("default")

    expect(() => funnel.channels.remove("ops")).not.toThrow()
  })

  test("claude, profiles, localConfig, localConfigSync are wired at construction", () => {
    const funnel = buildFunnel()

    expect(funnel.claude).toBeDefined()
    expect(funnel.profiles).toBeDefined()
    expect(funnel.localConfig).toBeDefined()
    expect(funnel.localConfigSync).toBeDefined()
  })
})
