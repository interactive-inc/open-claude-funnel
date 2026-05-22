import { afterEach, describe, expect, test } from "bun:test"
import { FunnelListenersClient } from "@/gateway/listeners-client"

const originalFetch = globalThis.fetch
const PORT = 19742

afterEach(() => {
  globalThis.fetch = originalFetch
})

const buildClient = (isRunning: boolean): FunnelListenersClient =>
  new FunnelListenersClient({
    port: PORT,
    isDaemonRunning: () => isRunning,
    getToken: () => "secret",
  })

describe("FunnelListenersClient", () => {
  test("returns offline when the daemon process is not running", async () => {
    const client = buildClient(false)

    expect(await client.list()).toEqual({ state: "offline" })
    expect(await client.start("ops", "cron")).toEqual({ state: "offline" })
    expect(await client.stop("ops", "cron")).toEqual({ state: "offline" })
    expect(await client.restart("ops", "cron")).toEqual({ state: "offline" })
  })

  test("list parses the running listeners response", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          listeners: [
            { channelName: "ops", channelId: "ch-1", name: "cron", type: "schedule", alive: true },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch

    const result = await buildClient(true).list()

    if (result.state !== "ok") throw new Error("expected ok state")

    expect(result.listeners).toHaveLength(1)
    expect(result.listeners[0]?.channelName).toBe("ops")
    expect(result.listeners[0]?.name).toBe("cron")
  })

  test("start hits POST /listeners/:channel/:connector/start with bearer auth", async () => {
    let capturedUrl = ""
    let capturedAuth = ""
    let capturedMethod = ""

    globalThis.fetch = (async (
      url: string,
      init?: { method?: string; headers?: Record<string, string> },
    ) => {
      capturedUrl = url
      capturedMethod = init?.method ?? "GET"
      capturedAuth = init?.headers?.authorization ?? ""

      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch

    const result = await buildClient(true).start("ops", "cron")

    expect(result).toEqual({ state: "ok" })
    expect(capturedUrl).toBe(`http://localhost:${PORT}/listeners/ops/cron/start`)
    expect(capturedMethod).toBe("POST")
    expect(capturedAuth).toBe("Bearer secret")
  })

  test("error responses surface the reason text", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ reason: "not running" }), {
        status: 400,
      })) as unknown as typeof fetch

    const result = await buildClient(true).stop("ops", "cron")

    expect(result).toEqual({ state: "error", reason: "not running" })
  })
})
