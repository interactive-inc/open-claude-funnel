import { describe, expect, test } from "bun:test"
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

  test("launch omits session flags when resume is left unset (the default)", async () => {
    // resume is opt-in now: a launch that doesn't ask for it starts fresh,
    // even with a profile name, so unrelated sessions can never bleed in.
    const { claude, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work", profileName: "dev" })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--session-id")).toBe(false)
    expect(attach.command.includes("--resume")).toBe(false)
  })

  test("launch never resumes without a profile, even when resume is true", async () => {
    // The session store is keyed by profile name; a profile-less launch has
    // no key to resume under, so it always starts a fresh, unrecorded session.
    const { claude, channel, sessions, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work", resume: true })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--session-id")).toBe(false)
    expect(attach.command.includes("--resume")).toBe(false)
    expect(sessions.get(channel.id, "dev")).toBeNull()
  })

  test("first launch of a profile injects --session-id with a freshly minted id", async () => {
    const { claude, channel, sessions, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work", profileName: "dev", resume: true })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    const idx = attach.command.indexOf("--session-id")

    expect(idx).toBeGreaterThan(0)
    expect(attach.command[idx + 1]).toEqual(sessions.get(channel.id, "dev") ?? undefined)
    expect(attach.command.includes("--resume")).toBe(false)
  })

  test("relaunching the same profile switches to --resume once the jsonl exists", async () => {
    // Regression for #1: claude's `--session-id` rejects ids whose jsonl
    // already exists, so the second launch has to use `--resume` instead.
    const { claude, channel, sessions, fs, process } = buildClaude()
    const env = { CLAUDE_CONFIG_DIR: "/cfg" }

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work", profileName: "dev", resume: true, env })

    const firstId = sessions.get(channel.id, "dev")

    // Simulate claude writing the session jsonl after the first launch.
    fs.mkdirSync("/cfg/projects/-work", { recursive: true })
    fs.writeFileSync(`/cfg/projects/-work/${firstId}.jsonl`, "{}")

    await claude.launch({ channel: "ops", cwd: "/work", profileName: "dev", resume: true, env })

    const attaches = process.calls.filter((c) => c.kind === "attach")

    if (attaches.length !== 2) throw new Error("expected two attach calls")
    if (attaches[0]?.kind !== "attach" || attaches[1]?.kind !== "attach") {
      throw new Error("unreachable")
    }

    const firstSessionIdx = attaches[0].command.indexOf("--session-id")
    expect(firstSessionIdx).toBeGreaterThan(0)
    expect(attaches[0].command[firstSessionIdx + 1]).toEqual(firstId ?? undefined)
    expect(attaches[0].command.includes("--resume")).toBe(false)

    expect(attaches[1].command.includes("--session-id")).toBe(false)

    const resumeIdx = attaches[1].command.indexOf("--resume")
    expect(resumeIdx).toBeGreaterThan(0)
    expect(attaches[1].command[resumeIdx + 1]).toEqual(firstId ?? undefined)
    expect(sessions.get(channel.id, "dev")).toEqual(firstId)
  })

  test("mints a fresh session when the persisted id has no jsonl on disk", async () => {
    // Self-heal: a recorded id can outlive its jsonl (claude pruned it, or the
    // first launch was aborted before the file appeared). Resuming it would
    // crash claude, so funnel must drop the dangling id and start fresh.
    const { claude, channel, sessions, fs, process } = buildClaude()
    const env = { CLAUDE_CONFIG_DIR: "/cfg" }

    fs.mkdirSync("/work", { recursive: true })
    const staleId = sessions.create(channel.id, "dev")

    await claude.launch({ channel: "ops", cwd: "/work", profileName: "dev", resume: true, env })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--resume")).toBe(false)

    const sessionIdx = attach.command.indexOf("--session-id")
    expect(sessionIdx).toBeGreaterThan(0)

    const freshId = attach.command[sessionIdx + 1]
    expect(freshId).not.toEqual(staleId)
    expect(sessions.get(channel.id, "dev") ?? undefined).toEqual(freshId)
  })

  test("two profiles in the same cwd keep distinct sessions", async () => {
    // The whole point of keying by profile: launching different profiles from
    // the same repo must not cross-resume into each other's conversation.
    const { claude, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work", profileName: "alpha", resume: true })
    await claude.launch({ channel: "ops", cwd: "/work", profileName: "beta", resume: true })

    const attaches = process.calls.filter((c) => c.kind === "attach")

    if (attaches[0]?.kind !== "attach" || attaches[1]?.kind !== "attach") {
      throw new Error("expected two attach calls")
    }

    const idA = attaches[0].command[attaches[0].command.indexOf("--session-id") + 1]
    const idB = attaches[1].command[attaches[1].command.indexOf("--session-id") + 1]

    expect(idA).not.toEqual(idB)
  })

  test("launch omits session flags when resume is false even if a session was previously persisted", async () => {
    // Pre-seeding makes this test catch a regression where resume=false would
    // still emit --resume for the persisted id. Without a pre-seeded session
    // the assertion would pass trivially.
    const { claude, channel, sessions, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })
    sessions.create(channel.id, "dev")

    await claude.launch({ channel: "ops", cwd: "/work", profileName: "dev", resume: false })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--session-id")).toBe(false)
    expect(attach.command.includes("--resume")).toBe(false)
  })

  test("launch omits session flags when the user passes -c or --continue", async () => {
    for (const flag of ["-c", "--continue"]) {
      const { claude, fs, process } = buildClaude()

      fs.mkdirSync("/work", { recursive: true })

      await claude.launch({
        channel: "ops",
        cwd: "/work",
        profileName: "dev",
        resume: true,
        userArgs: [flag],
      })

      const attach = process.calls.find((c) => c.kind === "attach")

      if (attach?.kind !== "attach") throw new Error("expected attach call")

      expect(attach.command.includes("--session-id")).toBe(false)
      expect(attach.command.indexOf("--resume")).toBe(-1)
      expect(attach.command.includes(flag)).toBe(true)
    }
  })

  test("launch omits its own session flags when the user passes --resume=<id> or --session-id=<id>", async () => {
    for (const userArg of ["--resume=abc", "--session-id=fixed"]) {
      const { claude, fs, process } = buildClaude()

      fs.mkdirSync("/work", { recursive: true })

      await claude.launch({
        channel: "ops",
        cwd: "/work",
        profileName: "dev",
        resume: true,
        userArgs: [userArg],
      })

      const attach = process.calls.find((c) => c.kind === "attach")

      if (attach?.kind !== "attach") throw new Error("expected attach call")

      // funnel must not append a separate flag — the user's equals-form arg
      // already carries the id, so emitting --session-id or --resume next to
      // it would either duplicate or shadow the user's choice.
      expect(attach.command.includes("--session-id")).toBe(false)
      expect(attach.command.includes("--resume")).toBe(false)
      expect(attach.command.includes(userArg)).toBe(true)
    }
  })

  test("launch omits its own --resume when the user passes --resume", async () => {
    const { claude, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({
      channel: "ops",
      cwd: "/work",
      profileName: "dev",
      resume: true,
      userArgs: ["--resume", "abc"],
    })

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

    await claude.launch({
      channel: "ops",
      cwd: "/work",
      profileName: "dev",
      resume: true,
      userArgs: ["--session-id", "fixed"],
    })

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
