import { afterEach, describe, expect, test } from "vitest"
import type { Server } from "bun"
import { Hono } from "hono"
import { Funnel } from "@/funnel"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import type { Env } from "@/gateway/factory"

const startServer = async (token: string) => {
  const fs = new MemoryFunnelFileSystem()
  const funnel = new Funnel({
    fs,
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
    tmpDir: "/tmp/funnel-test",
  })
  const server = funnel.gatewayServer({
    port: 0,
    killCompetingSlack: false,
    token,
    dbPath: "/tmp/funnel-test/events.db",
  })

  const httpServer = await server.start()
  return { server, httpServer, funnel }
}

const startServerWithExtras = async (extras: Hono<Env>) => {
  const fs = new MemoryFunnelFileSystem()
  const funnel = new Funnel({
    fs,
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
    tmpDir: "/tmp/funnel-test",
  })
  const server = funnel.gatewayServer({
    port: 0,
    killCompetingSlack: false,
    token: "",
    dbPath: "/tmp/funnel-test/events.db",
    extraRoutes: extras,
  })

  const httpServer = await server.start()
  return { server, httpServer }
}

let active: {
  server: { stop: () => Promise<void>; emit: (input: { channel: string; content: string; meta?: Record<string, string> }) => { offset: number } }
  httpServer: Server<unknown>
  funnel?: Funnel
} | null = null

afterEach(async () => {
  if (active) {
    await active.server.stop()
    active = null
  }
})

describe("FunnelGatewayServer auth integration", () => {
  test("/status returns 401 without bearer token", async () => {
    active = await startServer("secret-1")
    const url = `http://localhost:${active.httpServer.port}/status`
    const res = await fetch(url)

    expect(res.status).toBe(401)
  })

  test("/status returns 200 with the correct bearer token", async () => {
    active = await startServer("secret-2")
    const url = `http://localhost:${active.httpServer.port}/status`
    const res = await fetch(url, {
      headers: { authorization: "Bearer secret-2" },
    })

    expect(res.status).toBe(200)
  })

  test("/status returns 401 with the wrong bearer token", async () => {
    active = await startServer("secret-3")
    const url = `http://localhost:${active.httpServer.port}/status`
    const res = await fetch(url, {
      headers: { authorization: "Bearer nope" },
    })

    expect(res.status).toBe(401)
  })

  test("/health stays open without a token", async () => {
    active = await startServer("secret-4")
    const url = `http://localhost:${active.httpServer.port}/health`
    const res = await fetch(url)

    expect(res.status).toBe(200)
  })

  test("/listeners returns 401 without bearer token", async () => {
    active = await startServer("secret-5")
    const url = `http://localhost:${active.httpServer.port}/listeners`
    const res = await fetch(url)

    expect(res.status).toBe(401)
  })

  test("/ws upgrade is rejected without the sub-protocol or bearer header", async () => {
    active = await startServer("secret-6")
    const url = `http://localhost:${active.httpServer.port}/ws`
    const res = await fetch(url, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    })

    expect(res.status).toBe(401)
  })

  test("/ws upgrade succeeds with the funnel.token sub-protocol", async () => {
    active = await startServer("secret-7")
    const url = `ws://localhost:${active.httpServer.port}/ws?tap=all`

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, ["funnel.token.secret-7"])
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error("timeout"))
      }, 1000)

      ws.addEventListener("open", () => {
        clearTimeout(timeout)
        ws.close()
        resolve()
      })
      ws.addEventListener("error", (event) => {
        clearTimeout(timeout)
        reject(event instanceof Error ? event : new Error("ws error"))
      })
    })
  })

  test("/ws upgrade is rejected with the wrong token in sub-protocol", async () => {
    active = await startServer("secret-8")
    const url = `http://localhost:${active.httpServer.port}/ws`
    const res = await fetch(url, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        "sec-websocket-protocol": "funnel.token.bad",
      },
    })

    expect(res.status).toBe(401)
  })
})

describe("FunnelGatewayServer /channels/:channel/events", () => {
  test("returns events for a channel resolved by name, in offset order", async () => {
    active = await startServer("")
    const funnel = active.funnel

    if (!funnel) throw new Error("funnel missing")

    const channel = funnel.channels.add({ name: "inbox" })

    active.server.emit({ channel: "inbox", content: "one", meta: { event_type: "test" } })
    active.server.emit({ channel: "inbox", content: "two", meta: { event_type: "test" } })

    const url = `http://localhost:${active.httpServer.port}/channels/inbox/events`
    const res = await fetch(url)
    const body = (await res.json()) as {
      ok: boolean
      channel: string
      events: { offset: number; content: string; meta: Record<string, string> }[]
    }

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.channel).toBe("inbox")
    expect(body.events.map((e) => e.content)).toEqual(["one", "two"])
    expect(body.events[0]?.meta.channelId).toBe(channel.id)
  })

  test("?since=<offset> returns only events strictly after that offset", async () => {
    active = await startServer("")
    const funnel = active.funnel

    if (!funnel) throw new Error("funnel missing")

    funnel.channels.add({ name: "inbox" })

    const first = active.server.emit({ channel: "inbox", content: "a" })

    active.server.emit({ channel: "inbox", content: "b" })

    const url = `http://localhost:${active.httpServer.port}/channels/inbox/events?since=${first.offset}`
    const res = await fetch(url)
    const body = (await res.json()) as { events: { content: string }[] }

    expect(body.events.map((e) => e.content)).toEqual(["b"])
  })

  test("returns 404 when the channel does not exist", async () => {
    active = await startServer("")
    const url = `http://localhost:${active.httpServer.port}/channels/nope/events`
    const res = await fetch(url)

    expect(res.status).toBe(404)
  })

  test("requires bearer token when one is set", async () => {
    active = await startServer("secret-events")
    const url = `http://localhost:${active.httpServer.port}/channels/whatever/events`
    const res = await fetch(url)

    expect(res.status).toBe(401)
  })
})

describe("FunnelGatewayServer extraRoutes", () => {
  test("host routes are mounted and answer requests", async () => {
    const extras = new Hono<Env>()
    extras.get("/extra/ping", (c) => c.text("pong"))
    active = await startServerWithExtras(extras)

    const url = `http://localhost:${active.httpServer.port}/extra/ping`
    const res = await fetch(url)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("pong")
  })

  test("built-in routes still answer with extraRoutes mounted", async () => {
    const extras = new Hono<Env>()
    extras.get("/extra", (c) => c.text("extra"))
    active = await startServerWithExtras(extras)

    const url = `http://localhost:${active.httpServer.port}/health`
    const res = await fetch(url)

    expect(res.status).toBe(200)
  })

  test("host routes can read gateway deps from the context", async () => {
    const extras = new Hono<Env>()
    extras.get("/extra/clients", (c) => {
      const deps = c.get("deps")
      return c.json({ clients: deps.broadcaster.getClientCount() })
    })
    active = await startServerWithExtras(extras)

    const url = `http://localhost:${active.httpServer.port}/extra/clients`
    const res = await fetch(url)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ clients: 0 })
  })
})
