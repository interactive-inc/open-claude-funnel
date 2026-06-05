import { afterEach, describe, expect, test } from "bun:test"
import type { Server } from "bun"
import { Hono } from "hono"
import { Funnel } from "@/funnel"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import type { Env } from "@/gateway/factory"
import { MemoryFunnelEventLog } from "@/gateway/memory-funnel-event-log"

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
  return { server, httpServer }
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

const startServerOn = async (props: {
  token: string
  hostname?: string
  logger?: MemoryFunnelLogger
  allowInsecureHost?: boolean
}) => {
  const fs = new MemoryFunnelFileSystem()
  const funnel = new Funnel({
    fs,
    logger: props.logger ?? new NoopFunnelLogger(),
    dir: "/funnel",
    tmpDir: "/tmp/funnel-test",
  })
  const server = funnel.gatewayServer({
    port: 0,
    hostname: props.hostname,
    killCompetingSlack: false,
    token: props.token,
    allowInsecureHost: props.allowInsecureHost,
    dbPath: "/tmp/funnel-test/events.db",
  })

  const httpServer = await server.start()
  return { server, httpServer }
}

let active: { server: { stop: () => Promise<void> }; httpServer: Server<unknown> } | null = null

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
    const url = `ws://localhost:${active.httpServer.port}/ws`

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

describe("FunnelGatewayServer event log", () => {
  test("onEvent observes emitted events and an injected log records them", () => {
    const fs = new MemoryFunnelFileSystem()
    const funnel = new Funnel({
      fs,
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
      tmpDir: "/tmp/funnel-test",
    })
    funnel.channels.add({ name: "ops" })
    const eventLog = new MemoryFunnelEventLog()
    const server = funnel.gatewayServer({ port: 0, killCompetingSlack: false, token: "", eventLog })

    const observed: string[] = []
    server.onEvent((event) => observed.push(event.content))

    server.emit({ channel: "ops", content: "hello" })
    server.emit({ channel: "ops", content: "world" })

    expect(observed).toEqual(["hello", "world"])
    expect(eventLog.loadSince(0).map((event) => event.content)).toEqual(["hello", "world"])
    expect(server.getEventLog()).toBe(eventLog)
  })

  test("emit stamps channelId whether the channel is named by name or by id", () => {
    const fs = new MemoryFunnelFileSystem()
    const funnel = new Funnel({
      fs,
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
      tmpDir: "/tmp/funnel-test",
    })
    const channel = funnel.channels.add({ name: "ops" })
    const eventLog = new MemoryFunnelEventLog()
    const server = funnel.gatewayServer({ port: 0, killCompetingSlack: false, token: "", eventLog })

    const stamped: (string | undefined)[] = []
    server.onEvent((event) => stamped.push(event.meta?.channelId))

    // Publishing by id must resolve the same as by name. Otherwise channelId is
    // left unstamped and the broadcaster fans the event out across all channels.
    server.emit({ channel: channel.name, content: "by-name" })
    server.emit({ channel: channel.id, content: "by-id" })

    expect(stamped).toEqual([channel.id, channel.id])
  })
})

describe("FunnelGatewayServer bind address", () => {
  test("binds to loopback by default", async () => {
    active = await startServerOn({ token: "secret" })

    expect(active.httpServer.hostname).toBe("127.0.0.1")
  })

  test("refuses to start on a non-loopback bind without a token", async () => {
    await expect(startServerOn({ token: "", hostname: "0.0.0.0" })).rejects.toThrow(
      /reachable off-box but no token/,
    )
  })

  test("starts on a non-loopback bind when allowInsecureHost is set", async () => {
    active = await startServerOn({ token: "", hostname: "0.0.0.0", allowInsecureHost: true })

    expect(active.httpServer.hostname).toBe("0.0.0.0")
  })

  test("starts on a non-loopback bind with a token", async () => {
    active = await startServerOn({ token: "secret", hostname: "0.0.0.0" })

    expect(active.httpServer.hostname).toBe("0.0.0.0")
  })

  test("starts on a loopback bind even without a token", async () => {
    active = await startServerOn({ token: "" })

    expect(active.httpServer.hostname).toBe("127.0.0.1")
  })
})
