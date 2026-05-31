import { describe, expect, test } from "bun:test"
import { dispatchClaude } from "@/cli/dispatch-claude"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { Funnel } from "@/funnel"

type Setup = {
  funnel: Funnel
  fs: MemoryFunnelFileSystem
  process: MemoryFunnelProcessRunner
}

const FAKE_GATEWAY_PID = "12345"

const buildSetup = (
  opts: { files?: Record<string, string>; dirs?: string[] } = {},
): Setup => {
  const fs = new MemoryFunnelFileSystem({
    files: {
      "/sandbox/.funnel/gateway.pid": FAKE_GATEWAY_PID,
      ...opts.files,
    },
    dirs: ["/repo", "/work", "/sandbox/.funnel", ...(opts.dirs ?? [])],
  })
  const memoryProcess = new MemoryFunnelProcessRunner()

  memoryProcess.on(() => ({ exitCode: 0 }))
  memoryProcess.onSync((command) => {
    if (command[0] === "ps") return { exitCode: 0, stdout: "R\n" }

    return { exitCode: 0 }
  })

  const funnel = Funnel.inMemory({ fs, process: memoryProcess })

  return { funnel, fs, process: memoryProcess }
}

const lastAttach = (process: MemoryFunnelProcessRunner) => {
  for (let i = process.calls.length - 1; i >= 0; i--) {
    const call = process.calls[i]

    if (call?.kind === "attach") return call
  }

  return null
}

describe("dispatchClaude — argv parsing", () => {
  test("forwards positional args verbatim to claude", async () => {
    const { funnel, process } = buildSetup()
    funnel.channels.add({ name: "ops" })

    await dispatchClaude({ funnel, cwd: "/repo" }, ["--channel", "ops", "resume", "abc123"])

    const attach = lastAttach(process)

    expect(attach?.command).toEqual(
      expect.arrayContaining(["claude", "resume", "abc123"]),
    )
  })

  test("forwards unknown short flags verbatim to claude", async () => {
    const { funnel, process } = buildSetup()
    funnel.channels.add({ name: "ops" })

    await dispatchClaude({ funnel, cwd: "/repo" }, ["--channel", "ops", "-c"])

    const attach = lastAttach(process)

    expect(attach?.command).toEqual(expect.arrayContaining(["claude", "-c"]))
  })

  test("forwards --agent xxx verbatim", async () => {
    const { funnel, process } = buildSetup()
    funnel.channels.add({ name: "ops" })

    await dispatchClaude({ funnel, cwd: "/repo" }, [
      "--channel",
      "ops",
      "--agent",
      "developer",
    ])

    const attach = lastAttach(process)

    expect(attach?.command).toEqual(
      expect.arrayContaining(["claude", "--agent", "developer"]),
    )
  })

  test("supports --profile=<name> equals form", async () => {
    const { funnel, process } = buildSetup()
    const channel = funnel.channels.add({ name: "ops" })

    funnel.profiles.add({
      name: "cto",
      path: "/work",
      channelId: channel.id,
    })

    await dispatchClaude({ funnel, cwd: "/repo" }, ["--profile=cto", "--agent", "other"])

    const attach = lastAttach(process)

    expect(attach?.options.cwd).toEqual("/work")
    expect(attach?.command).toEqual(expect.arrayContaining(["--agent", "other"]))
  })

  test("supports -p shorthand", async () => {
    const { funnel, process } = buildSetup()
    const channel = funnel.channels.add({ name: "ops" })

    funnel.profiles.add({
      name: "cto",
      path: "/work",
      channelId: channel.id,
    })

    await dispatchClaude({ funnel, cwd: "/repo" }, ["-p", "cto"])

    expect(lastAttach(process)?.options.cwd).toEqual("/work")
  })

  test("returns help when --help is given", async () => {
    const { funnel } = buildSetup()

    const result = await dispatchClaude({ funnel, cwd: "/repo" }, ["--help"])

    expect(result.exitCode).toEqual(0)
    expect(result.stdout).toContain("funnel claude")
  })

  test("returns stderr and exit 1 when profile is missing", async () => {
    const { funnel } = buildSetup()

    const result = await dispatchClaude({ funnel, cwd: "/repo" }, ["--profile", "missing"])

    expect(result.exitCode).toEqual(1)
    expect(result.stderr).toContain("not found")
  })

  test("errors when --profile and --channel are combined", async () => {
    const { funnel } = buildSetup()
    const channel = funnel.channels.add({ name: "ops" })

    funnel.profiles.add({
      name: "cto",
      path: "/work",
      channelId: channel.id,
    })

    const result = await dispatchClaude({ funnel, cwd: "/repo" }, [
      "--profile",
      "cto",
      "--channel",
      "ops",
    ])

    expect(result.exitCode).toEqual(1)
    expect(result.stderr).toContain("cannot be combined")
  })

  test("reads funnel.json from cwd and launches the first declared channel", async () => {
    const { funnel, process } = buildSetup({
      files: {
        "/repo/funnel.json": JSON.stringify({ channels: [{ name: "ops" }] }),
      },
    })

    await dispatchClaude({ funnel, cwd: "/repo" }, ["--agent", "developer"])

    // The channel is materialized into the funnel the launch uses. (cli/index.ts
    // points FUNNEL_DIR at ~/.funnel/projects/<id>/ before dispatch runs; dispatch
    // itself just reads funnel.json and syncs into the funnel it is handed.)
    expect(funnel.channels.get("ops")).not.toBeNull()

    const attach = lastAttach(process)

    expect(attach?.options.cwd).toEqual("/repo")
    expect(attach?.command).toEqual(expect.arrayContaining(["--agent", "developer"]))
  })

  test("picks a non-default channel by --channel name", async () => {
    const { funnel, process } = buildSetup({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }, { name: "review" }],
          profiles: [
            { channel: "ops", options: ["--agent", "pm"] },
            { channel: "review", options: ["--agent", "reviewer"] },
          ],
        }),
      },
    })

    await dispatchClaude({ funnel, cwd: "/repo" }, ["--channel", "review"])

    const command = lastAttach(process)?.command ?? []

    expect(command).toEqual(expect.arrayContaining(["--agent", "reviewer"]))
    expect(command).not.toContain("pm")
  })

  test("errors when --channel names a channel not in funnel.json", async () => {
    const { funnel } = buildSetup({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }],
        }),
      },
    })

    const result = await dispatchClaude({ funnel, cwd: "/repo" }, [
      "--channel",
      "missing",
    ])

    expect(result.exitCode).toEqual(1)
    expect(result.stderr).toContain("missing")
  })

  test("falls back to default profile when no funnel.json and no flags", async () => {
    const { funnel, process } = buildSetup()
    const channel = funnel.channels.add({ name: "ops" })

    funnel.profiles.add({
      name: "default-profile",
      path: "/work",
      channelId: channel.id,
    })

    await dispatchClaude({ funnel, cwd: "/repo" }, [])

    expect(lastAttach(process)?.options.cwd).toEqual("/work")
  })

  test("shows help when no flags, no funnel.json, and no default profile", async () => {
    const { funnel } = buildSetup()

    const result = await dispatchClaude({ funnel, cwd: "/repo" }, [])

    expect(result.exitCode).toEqual(0)
    expect(result.stdout).toContain("funnel claude")
  })

  test("prepends profile options before user CLI args", async () => {
    const { funnel, process } = buildSetup({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }],
          profiles: [{ channel: "ops", options: ["--brief", "--agent", "developer"] }],
        }),
      },
    })

    await dispatchClaude({ funnel, cwd: "/repo" }, ["--resume", "abc"])

    const attach = lastAttach(process)
    const command = attach?.command ?? []
    const briefIdx = command.indexOf("--brief")
    const resumeIdx = command.indexOf("--resume")

    expect(briefIdx).toBeGreaterThanOrEqual(0)
    expect(resumeIdx).toBeGreaterThan(briefIdx)
    expect(command).toEqual(expect.arrayContaining(["--agent", "developer", "--resume", "abc"]))
  })

  test("merges profile env into the claude process env", async () => {
    const { funnel, process } = buildSetup({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }],
          profiles: [
            {
              channel: "ops",
              env: { ANTHROPIC_MODEL: "claude-sonnet-4-6", FUNNEL_ONLY: "yes" },
            },
          ],
        }),
      },
    })

    await dispatchClaude({ funnel, cwd: "/repo" }, [])

    const attach = lastAttach(process)

    expect(attach?.options.env?.ANTHROPIC_MODEL).toEqual("claude-sonnet-4-6")
    expect(attach?.options.env?.FUNNEL_ONLY).toEqual("yes")
  })
})
