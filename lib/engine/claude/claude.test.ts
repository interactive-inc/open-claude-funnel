import { describe, expect, test } from "vitest"
import { FunnelConnectorFactory } from "@/connectors/connector-factory"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelClaude } from "@/engine/claude/claude"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { FunnelMcp } from "@/engine/mcp/mcp"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { FunnelSessions } from "@/engine/sessions/sessions"
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
  const sessions = new FunnelSessions({
    fs,
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "sess" }),
    dir: "/funnel",
  })
  const claude = new FunnelClaude({
    channels,
    mcp,
    gateway,
    sessions,
    fs,
    process,
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
  })

  return { claude, channels, channel, fs, process, sessions }
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

  test("first launch from a cwd injects --session-id with a freshly minted id", async () => {
    const { claude, channel, sessions, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work" })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    const idx = attach.command.indexOf("--session-id")

    expect(idx).toBeGreaterThan(0)
    expect(attach.command[idx + 1]).toEqual(sessions.get(channel.id, "/work"))
    expect(attach.command.includes("--resume")).toBe(false)
  })

  test("relaunching from the same cwd switches to --resume with the persisted id", async () => {
    // Regression for #1: claude's `--session-id` rejects ids whose jsonl
    // already exists, so the second launch has to use `--resume` instead.
    const { claude, channel, sessions, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work" })

    const firstId = sessions.get(channel.id, "/work")

    await claude.launch({ channel: "ops", cwd: "/work" })

    const attaches = process.calls.filter((c) => c.kind === "attach")

    if (attaches.length !== 2) throw new Error("expected two attach calls")
    if (attaches[0]?.kind !== "attach" || attaches[1]?.kind !== "attach") {
      throw new Error("unreachable")
    }

    const firstSessionIdx = attaches[0].command.indexOf("--session-id")
    expect(firstSessionIdx).toBeGreaterThan(0)
    expect(attaches[0].command[firstSessionIdx + 1]).toEqual(firstId)
    expect(attaches[0].command.includes("--resume")).toBe(false)

    expect(attaches[1].command.includes("--session-id")).toBe(false)

    const resumeIdx = attaches[1].command.indexOf("--resume")
    expect(resumeIdx).toBeGreaterThan(0)
    expect(attaches[1].command[resumeIdx + 1]).toEqual(firstId)
    expect(sessions.get(channel.id, "/work")).toEqual(firstId)
  })

  test("launch uses distinct fresh session ids for different cwds", async () => {
    const { claude, fs, process } = buildClaude()

    fs.mkdirSync("/work-a", { recursive: true })
    fs.mkdirSync("/work-b", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work-a" })
    await claude.launch({ channel: "ops", cwd: "/work-b" })

    const attaches = process.calls.filter((c) => c.kind === "attach")

    if (attaches[0]?.kind !== "attach" || attaches[1]?.kind !== "attach") {
      throw new Error("expected two attach calls")
    }

    const idA = attaches[0].command[attaches[0].command.indexOf("--session-id") + 1]
    const idB = attaches[1].command[attaches[1].command.indexOf("--session-id") + 1]

    expect(idA).not.toEqual(idB)
  })

  test("launch omits session flags when channel.resume is false", async () => {
    const { claude, channels, fs, process } = buildClaude()

    channels.setResume("ops", false)
    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work" })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--session-id")).toBe(false)
    expect(attach.command.includes("--resume")).toBe(false)
  })

  test("launch omits session flags when the user passes -c", async () => {
    const { claude, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work", userArgs: ["-c"] })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--session-id")).toBe(false)
    expect(attach.command.indexOf("--resume")).toBe(-1)
    expect(attach.command.includes("-c")).toBe(true)
  })

  test("launch omits its own --resume when the user passes --resume", async () => {
    const { claude, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work", userArgs: ["--resume", "abc"] })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--session-id")).toBe(false)

    const resumeIndexes: number[] = []
    attach.command.forEach((arg, i) => {
      if (arg === "--resume") resumeIndexes.push(i)
    })

    expect(resumeIndexes).toHaveLength(1)
    expect(attach.command[resumeIndexes[0]! + 1]).toEqual("abc")
  })

  test("launch omits --session-id when the user passes their own --session-id", async () => {
    const { claude, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work", userArgs: ["--session-id", "fixed"] })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    const sessionIndexes: number[] = []
    attach.command.forEach((arg, i) => {
      if (arg === "--session-id") sessionIndexes.push(i)
    })

    expect(sessionIndexes).toHaveLength(1)
    expect(attach.command[sessionIndexes[0]! + 1]).toEqual("fixed")
  })
})
