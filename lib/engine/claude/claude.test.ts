import { describe, expect, test } from "vitest"
import { FunnelClaude } from "@/engine/claude/claude"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { FunnelProfiles } from "@/engine/profiles/profiles"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import type { ChannelConfig } from "@/engine/settings/settings-schema"

const FAKE_CHANNEL: ChannelConfig = {
  id: "ch-ops-id",
  name: "ops",
  delivery: "fanout",
  connectors: [],
}

type GatewayStub = {
  isRunning: () => boolean
  start: () => Promise<boolean>
}

const buildClaude = (overrides: { gateway?: GatewayStub } = {}) => {
  const fs = new MemoryFunnelFileSystem()
  const process = new MemoryFunnelProcessRunner().on(() => ({ exitCode: 0 }))
  const store = new MockFunnelSettingsReader({ channels: [FAKE_CHANNEL] })
  const sessions = new FunnelProfiles({
    store,
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "prof" }),
    fs,
  })
  const channels = {
    get: (name: string): ChannelConfig | null => (name === "ops" ? FAKE_CHANNEL : null),
    getById: (id: string): ChannelConfig | null => (id === FAKE_CHANNEL.id ? FAKE_CHANNEL : null),
  }
  const mcp = {
    findInstalledName: (_cwd: string): string | null => null,
    install: (_cwd: string): void => {},
  }
  const gateway = overrides.gateway ?? {
    isRunning: () => true,
    start: async () => true,
  }
  // Simple in-memory guard: tracks acquired profileIds so tests can simulate
  // a live process without touching the real filesystem or process table.
  const acquired = new Set<string>()
  const guard = {
    isRunning: (profileId: string) => acquired.has(profileId),
    acquire: (profileId: string) => {
      acquired.add(profileId)
    },
    release: (profileId: string) => {
      acquired.delete(profileId)
    },
  }
  const claude = new FunnelClaude({
    channels,
    mcp,
    gateway,
    sessions,
    guard,
    process,
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "sess" }),
    logger: new NoopFunnelLogger(),
  })

  // Sessions (profiles) are addressed by id internally; seed a few and hand back their ids
  // so each test can launch under a known profile.
  const addProfile = (name: string): string => {
    sessions.add({ name, path: "/work", channelId: FAKE_CHANNEL.id })

    const created = sessions.get(name)

    if (!created) throw new Error(`failed to seed profile "${name}"`)

    return created.id
  }

  return {
    claude,
    channel: FAKE_CHANNEL,
    fs,
    process,
    profiles: sessions,
    guard,
    acquired,
    addProfile,
  }
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

  test("launch aborts when the gateway fails to start", async () => {
    // A port collision (two scoped repos on the shared default port) makes the
    // spawned daemon die on EADDRINUSE, so start() returns false. Launching
    // anyway would attach the agent's MCP to a different repo's gateway and
    // receive no events — so launch must fail loudly instead.
    const { claude, fs } = buildClaude({
      gateway: { isRunning: () => false, start: async () => false },
    })

    fs.mkdirSync("/work", { recursive: true })

    await expect(claude.launch({ channel: "ops", cwd: "/work" })).rejects.toThrow(
      /gateway failed to start/,
    )
  })

  test("launch refuses to start a profile that is already running", async () => {
    const { claude, acquired, addProfile } = buildClaude()

    const devId = addProfile("dev")

    acquired.add(devId)

    await expect(claude.launch({ channel: "ops", profileId: devId })).rejects.toThrow(
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
    // even with a profile, so unrelated sessions can never bleed in.
    const { claude, fs, process, profiles, addProfile } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    const devId = addProfile("dev")

    await claude.launch({ channel: "ops", cwd: "/work", profileId: devId })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--session-id")).toBe(false)
    expect(attach.command.includes("--resume")).toBe(false)
    expect(profiles.getSessionId(devId)).toBeNull()
  })

  test("a profile-less launch starts a fresh, unrecorded session", async () => {
    // The session is owned by the profile; a profile-less launch has no profile
    // to resume under, so it always starts a fresh session. `resume` can no
    // longer even be passed here — the LaunchOptions union requires a profileId
    // for it, so the old "resume is silently ignored" path is now a compile error.
    const { claude, fs, process } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({ channel: "ops", cwd: "/work" })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--session-id")).toBe(false)
    expect(attach.command.includes("--resume")).toBe(false)
  })

  test("first launch of a profile injects --session-id with a freshly minted id", async () => {
    const { claude, fs, process, profiles, addProfile } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    const devId = addProfile("dev")

    await claude.launch({ channel: "ops", cwd: "/work", profileId: devId, resume: true })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    const idx = attach.command.indexOf("--session-id")

    expect(idx).toBeGreaterThan(0)
    expect(attach.command[idx + 1]).toEqual(profiles.getSessionId(devId) ?? undefined)
    expect(attach.command.includes("--resume")).toBe(false)
  })

  test("relaunching the same profile switches to --resume once the jsonl exists", async () => {
    // Regression for #1: claude's `--session-id` rejects ids whose jsonl
    // already exists, so the second launch has to use `--resume` instead.
    const { claude, fs, process, profiles, addProfile } = buildClaude()
    const env = { CLAUDE_CONFIG_DIR: "/cfg" }

    fs.mkdirSync("/work", { recursive: true })

    const devId = addProfile("dev")

    await claude.launch({ channel: "ops", cwd: "/work", profileId: devId, resume: true, env })

    const firstId = profiles.getSessionId(devId)

    // Simulate claude writing the session jsonl after the first launch.
    fs.mkdirSync("/cfg/projects/-work", { recursive: true })
    fs.writeFileSync(`/cfg/projects/-work/${firstId}.jsonl`, "{}")

    await claude.launch({ channel: "ops", cwd: "/work", profileId: devId, resume: true, env })

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
    expect(profiles.getSessionId(devId)).toEqual(firstId)
  })

  test("starts fresh when the jsonl exists but is empty (corrupt session)", async () => {
    // Regression: an empty/whitespace-only jsonl is a session claude rejects with
    // "No conversation found"; funnel must treat it as missing and start fresh.
    const { claude, fs, process, profiles, addProfile } = buildClaude()
    const env = { CLAUDE_CONFIG_DIR: "/cfg" }

    fs.mkdirSync("/work", { recursive: true })

    const devId = addProfile("dev")

    await claude.launch({ channel: "ops", cwd: "/work", profileId: devId, resume: true, env })

    const firstId = profiles.getSessionId(devId)

    fs.mkdirSync("/cfg/projects/-work", { recursive: true })
    fs.writeFileSync(`/cfg/projects/-work/${firstId}.jsonl`, "   \n")

    await claude.launch({ channel: "ops", cwd: "/work", profileId: devId, resume: true, env })

    const attaches = process.calls.filter((c) => c.kind === "attach")

    if (attaches[1]?.kind !== "attach") throw new Error("expected two attach calls")

    expect(attaches[1].command.includes("--resume")).toBe(false)
    expect(attaches[1].command.includes("--session-id")).toBe(true)
  })

  test("mints a fresh session when the persisted id has no jsonl on disk", async () => {
    // Self-heal: a recorded id can outlive its jsonl (claude pruned it, or the
    // first launch was aborted before the file appeared). Resuming it would
    // crash claude, so funnel must drop the dangling id and start fresh.
    const { claude, fs, process, profiles, addProfile } = buildClaude()
    const env = { CLAUDE_CONFIG_DIR: "/cfg" }

    fs.mkdirSync("/work", { recursive: true })

    const devId = addProfile("dev")
    profiles.setSessionId(devId, "stale-session")

    await claude.launch({ channel: "ops", cwd: "/work", profileId: devId, resume: true, env })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--resume")).toBe(false)

    const sessionIdx = attach.command.indexOf("--session-id")
    expect(sessionIdx).toBeGreaterThan(0)

    const freshId = attach.command[sessionIdx + 1]
    expect(freshId).not.toEqual("stale-session")
    expect(profiles.getSessionId(devId) ?? undefined).toEqual(freshId)
  })

  test("two profiles in the same cwd keep distinct sessions", async () => {
    // The whole point of keying by profile: launching different profiles from
    // the same repo must not cross-resume into each other's conversation.
    const { claude, fs, process, addProfile } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    const alphaId = addProfile("alpha")
    const betaId = addProfile("beta")

    await claude.launch({ channel: "ops", cwd: "/work", profileId: alphaId, resume: true })
    await claude.launch({ channel: "ops", cwd: "/work", profileId: betaId, resume: true })

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
    const { claude, fs, process, profiles, addProfile } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    const devId = addProfile("dev")
    profiles.setSessionId(devId, "prior-session")

    await claude.launch({ channel: "ops", cwd: "/work", profileId: devId, resume: false })

    const attach = process.calls.find((c) => c.kind === "attach")

    if (attach?.kind !== "attach") throw new Error("expected attach call")

    expect(attach.command.includes("--session-id")).toBe(false)
    expect(attach.command.includes("--resume")).toBe(false)
  })

  test("launch omits session flags when the user passes -c or --continue", async () => {
    for (const flag of ["-c", "--continue"]) {
      const { claude, fs, process, addProfile } = buildClaude()

      fs.mkdirSync("/work", { recursive: true })

      await claude.launch({
        channel: "ops",
        cwd: "/work",
        profileId: addProfile("dev"),
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
      const { claude, fs, process, addProfile } = buildClaude()

      fs.mkdirSync("/work", { recursive: true })

      await claude.launch({
        channel: "ops",
        cwd: "/work",
        profileId: addProfile("dev"),
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
    const { claude, fs, process, addProfile } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({
      channel: "ops",
      cwd: "/work",
      profileId: addProfile("dev"),
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
    const { claude, fs, process, addProfile } = buildClaude()

    fs.mkdirSync("/work", { recursive: true })

    await claude.launch({
      channel: "ops",
      cwd: "/work",
      profileId: addProfile("dev"),
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
