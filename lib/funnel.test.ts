import { describe, expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelProfiles } from "@/engine/profiles/profiles"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"

const buildCore = (): Funnel =>
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
    const funnel = buildCore()

    funnel.channels.add({ name: "ops" })
    funnel.channels.addConnector("ops", { type: "schedule", name: "cron" })

    expect(funnel.channels.listAllConnectors()).toHaveLength(1)
  })

  test("profiles see the same store as channels (shared settings)", () => {
    const funnel = buildCore()
    const profiles = new FunnelProfiles({ store: funnel.store, idGenerator: funnel.idGenerator })

    const channel = funnel.channels.add({ name: "ops" })

    profiles.add({
      name: "default",
      path: "/repo",
      channelId: channel.id,
    })

    expect(profiles.list()).toHaveLength(1)
    expect(profiles.get("default")?.channelId).toBe(channel.id)
  })

  test("channels.remove works without a profileChecker wired", () => {
    const funnel = buildCore()
    const profiles = new FunnelProfiles({ store: funnel.store, idGenerator: funnel.idGenerator })
    const channel = funnel.channels.add({ name: "ops" })

    profiles.add({
      name: "default",
      path: "/repo",
      channelId: channel.id,
    })

    // profileChecker is not wired in core — remove proceeds without checking
    expect(() => funnel.channels.remove("ops")).not.toThrow()
  })
})
