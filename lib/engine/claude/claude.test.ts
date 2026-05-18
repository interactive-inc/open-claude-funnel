import { describe, expect, test } from "vitest"
import { FunnelConnectorFactory } from "@/connectors/connector-factory"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelClaude } from "@/engine/claude/claude"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { FunnelMcp } from "@/engine/mcp/mcp"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

const profileChecker = { hasChannelRef: () => false }

const buildClaude = () => {
  const fs = new MemoryFunnelFileSystem()
  const process = new MemoryFunnelProcessRunner().on(() => ({ exitCode: 0 }))
  const store = new MockFunnelSettingsReader()
  const factory = new FunnelConnectorFactory({
    fs,
    process,
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
  })
  const channels = new FunnelChannels({
    store,
    factory,
    profileChecker,
    clock: new MemoryFunnelClock(),
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "ch" }),
  })
  const channel = channels.add({ name: "ops" })
  const mcp = new FunnelMcp({ fs })
  const gateway = {
    isRunning: () => true,
    start: async () => true,
  }
  const claude = new FunnelClaude({
    channels,
    mcp,
    gateway,
    fs,
    process,
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
  })

  return { claude, channels, channel, fs, process }
}

describe("FunnelClaude", () => {
  test("launch injects FUNNEL_CHANNEL_ID with the channel id, not the name", async () => {
    const { claude, channel, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work" })

    const attachCall = process.calls.find((c) => c.kind === "attach")

    if (attachCall?.kind !== "attach") {
      throw new Error("expected attach call")
    }

    expect(attachCall.options.env?.FUNNEL_CHANNEL_ID).toBe(channel.id)
  })

  test("launch throws when the channel does not exist", async () => {
    const { claude } = buildClaude()

    await expect(claude.launch({ channel: "nope" })).rejects.toThrow(/not found/)
  })

  test("launch refuses to start a profile that already has a live PID file", async () => {
    const { claude, fs, process } = buildClaude()

    process.on(() => ({ exitCode: 0 }))
    process.onSync(() => ({ exitCode: 0, stdout: "S\n", stderr: "" }))

    fs.mkdirSync("/funnel/claude", { recursive: true })
    fs.writeFileSync("/funnel/claude/dev.pid", String(globalThis.process.pid))

    await expect(claude.launch({ channel: "ops", profileName: "dev" })).rejects.toThrow(
      /already running/,
    )
  })

  test("launch forwards onSpawned callback to the process runner", async () => {
    const { claude, fs } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    const spawnedPids: number[] = []
    await claude.launch({
      channel: "ops",
      cwd: "/work",
      onSpawned: (pid) => spawnedPids.push(pid),
    })

    expect(spawnedPids).toHaveLength(1)
    expect(spawnedPids[0]).toBe(1)
  })

  test("launch skips MCP install when installMcp is false", async () => {
    const { claude, fs } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work", installMcp: false })

    expect(fs.existsSync("/work/.mcp.json")).toBe(false)
  })
})
