import { describe, expect, test } from "vitest"
import { Funnel } from "@/funnel"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"

const buildFunnel = (): Funnel =>
  new Funnel({
    store: new MockFunnelSettingsReader(),
    fs: new MemoryFunnelFileSystem(),
    process: new MemoryFunnelProcessRunner(),
    logger: new NoopFunnelLogger(),
    clock: new MemoryFunnelClock(),
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "id" }),
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
      subAgent: "router",
      channelId: channel.id,
    })

    expect(funnel.profiles.list()).toHaveLength(1)
    expect(funnel.profiles.get("default")?.channelId).toBe(channel.id)
  })

  test("removing a channel referenced by a profile is rejected", () => {
    const funnel = buildFunnel()
    const channel = funnel.channels.add({ name: "ops" })

    funnel.profiles.add({
      name: "default",
      path: "/repo",
      subAgent: "router",
      channelId: channel.id,
    })

    expect(() => funnel.channels.remove("ops")).toThrow(/referenced by a profile/)
  })
})
