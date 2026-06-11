import { describe, expect, test } from "bun:test"
import { routes } from "@/cli/routes"
import { Funnel } from "@/funnel"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { MemoryFunnelTokenPrompter } from "@/engine/token-prompter/memory-token-prompter"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"

type RouteEnv = {
  funnel: Funnel
  claude: Funnel["claude"]
  profiles: Funnel["profiles"]
  localConfig: Funnel["localConfig"]
  localConfigSync: Funnel["localConfigSync"]
}

const buildEnv = (): RouteEnv => {
  const funnel = new Funnel({
    store: new MockFunnelSettingsReader(),
    fs: new MemoryFunnelFileSystem(),
    process: new MemoryFunnelProcessRunner(),
    logger: new NoopFunnelLogger(),
    clock: new MemoryFunnelClock(),
    idGenerator: new MemoryFunnelIdGenerator({ prefix: "id" }),
    tokenPrompter: new MemoryFunnelTokenPrompter(),
  })

  return {
    funnel,
    claude: funnel.claude,
    profiles: funnel.profiles,
    localConfig: funnel.localConfig,
    localConfigSync: funnel.localConfigSync,
  }
}

const request = async (
  env: RouteEnv,
  method: "GET" | "POST",
  path: string,
): Promise<{ status: number; text: string }> => {
  const res = await routes.request(`http://localhost${path}`, { method }, env)

  return { status: res.status, text: await res.text() }
}

describe("CLI routes: channels", () => {
  test("GET /channels lists channels as YAML", async () => {
    const env = buildEnv()

    env.funnel.channels.add({ name: "ops" })

    const res = await request(env, "GET", "/channels")

    expect(res.status).toBe(200)
    expect(res.text).toContain("name: ops")
  })

  test("POST /channels/add/:channel creates the channel", async () => {
    const env = buildEnv()

    const res = await request(env, "POST", "/channels/add/ops")

    expect(res.status).toBe(200)
    expect(res.text).toContain(`added channel "ops"`)
    expect(env.funnel.channels.get("ops")).not.toBeNull()
  })

  test("POST /channels/add/:channel honors the delivery query", async () => {
    const env = buildEnv()

    await request(env, "POST", "/channels/add/workers?delivery=exclusive")

    expect(env.funnel.channels.get("workers")?.delivery).toBe("exclusive")
  })

  test("POST /channels/add/:channel rejects an unknown delivery mode with a readable message", async () => {
    const env = buildEnv()

    const res = await request(env, "POST", "/channels/add/ops?delivery=broadcast")

    expect(res.status).toBe(400)
    expect(res.text).toContain("--delivery")
    expect(res.text).not.toContain("ZodError")
    expect(env.funnel.channels.get("ops")).toBeNull()
  })

  test("POST /channels/remove/:channel returns an error for an unknown channel", async () => {
    const env = buildEnv()

    env.funnel.channels.add({ name: "ops" })

    const res = await request(env, "POST", "/channels/remove/missing")

    expect(res.status).toBe(404)
    expect(res.text).toContain(`channel "missing" not found`)
    expect(res.text).toContain("available: ops")
    expect(res.text).toContain("fnl channels add")
  })

  test("POST /channels/remove/:channel refuses when a profile references it", async () => {
    const env = buildEnv()
    const channel = env.funnel.channels.add({ name: "ops" })

    env.profiles.add({ name: "dev", path: "/repo", channelId: channel.id })

    const res = await request(env, "POST", "/channels/remove/ops")

    expect(res.status).toBe(400)
    expect(res.text).toContain("referenced by a profile")
    expect(env.funnel.channels.get("ops")).not.toBeNull()
  })

  test("POST /channels/:channel/rename/:newName renames and keeps the id", async () => {
    const env = buildEnv()
    const created = env.funnel.channels.add({ name: "ops" })

    const res = await request(env, "POST", "/channels/ops/rename/prod")

    expect(res.status).toBe(200)
    expect(env.funnel.channels.get("ops")).toBeNull()
    expect(env.funnel.channels.get("prod")?.id).toBe(created.id)
  })

  test("GET /channels?help=true returns the group help", async () => {
    const env = buildEnv()

    const res = await request(env, "GET", "/channels?help=true")

    expect(res.status).toBe(200)
    expect(res.text).toContain("funnel channels / manage subscription boxes")
  })
})

describe("CLI routes: connectors", () => {
  test("POST .../connectors/add/:connector adds a schedule connector", async () => {
    const env = buildEnv()

    env.funnel.channels.add({ name: "ops" })

    const res = await request(env, "POST", "/channels/ops/connectors/add/cron?type=schedule")

    expect(res.status).toBe(200)
    expect(env.funnel.channels.get("ops")?.connectors).toHaveLength(1)
  })

  test("POST .../connectors/add/:connector rejects a malformed slack bot token", async () => {
    const env = buildEnv()

    env.funnel.channels.add({ name: "ops" })

    const res = await request(
      env,
      "POST",
      "/channels/ops/connectors/add/slack-c?type=slack&bot-token=not-a-token&app-token=xapp-1-x",
    )

    expect(res.status).toBe(400)
    expect(env.funnel.channels.get("ops")?.connectors).toHaveLength(0)
  })

  test("POST .../connectors/remove/:connector deletes the connector", async () => {
    const env = buildEnv()

    env.funnel.channels.add({ name: "ops" })
    env.funnel.channels.addConnector("ops", { type: "schedule", name: "cron" })

    const res = await request(env, "POST", "/channels/ops/connectors/remove/cron")

    expect(res.status).toBe(200)
    expect(env.funnel.channels.get("ops")?.connectors).toHaveLength(0)
  })
})

describe("CLI routes: profiles", () => {
  test("POST /profiles/add/:profile binds the named channel", async () => {
    const env = buildEnv()
    const channel = env.funnel.channels.add({ name: "ops" })

    const res = await request(env, "POST", "/profiles/add/dev?path=/repo&channel=ops")

    expect(res.status).toBe(200)
    expect(env.profiles.get("dev")?.channelId).toBe(channel.id)
  })

  test("POST /profiles/add/:profile fails for an unknown channel", async () => {
    const env = buildEnv()

    const res = await request(env, "POST", "/profiles/add/dev?path=/repo&channel=missing")

    expect(res.status).toBe(400)
    expect(res.text).toContain(`channel "missing" not found`)
    expect(env.profiles.get("dev")).toBeNull()
  })

  test("POST /profiles/remove/:profile deletes the profile", async () => {
    const env = buildEnv()
    const channel = env.funnel.channels.add({ name: "ops" })

    env.profiles.add({ name: "dev", path: "/repo", channelId: channel.id })

    const res = await request(env, "POST", "/profiles/remove/dev")

    expect(res.status).toBe(200)
    expect(env.profiles.get("dev")).toBeNull()
  })
})

describe("CLI routes: docs", () => {
  test("GET /docs lists topics", async () => {
    const env = buildEnv()

    const res = await request(env, "GET", "/docs")

    expect(res.status).toBe(200)
    expect(res.text).toContain("architecture")
  })

  test("GET /docs/:topic returns the topic body", async () => {
    const env = buildEnv()

    const res = await request(env, "GET", "/docs/channels")

    expect(res.status).toBe(200)
    expect(res.text.length).toBeGreaterThan(100)
  })
})
