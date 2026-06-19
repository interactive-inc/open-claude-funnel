import { afterEach, describe, expect, test } from "vitest"

const isBun = typeof globalThis.Bun !== "undefined"
import { Hono } from "hono"
import { Funnel } from "@/funnel"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import type { Env } from "@/gateway/factory"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import type { ReplayableEvent } from "@/gateway/broadcaster"
import { FunnelEventLog, type FunnelEventRecord } from "@/gateway/event-log/event-log"

class TrackableEventLog extends FunnelEventLog {
  closeCalled = false
  private readonly inner = new MemoryFunnelEventLog()

  record(record: FunnelEventRecord): void { this.inner.record(record) }
  loadSince(since: number): ReplayableEvent[] { return this.inner.loadSince(since) }
  findMaxOffset(): number { return this.inner.findMaxOffset() }
  clear(): void { this.inner.clear() }
  close(): void { this.closeCalled = true }
}

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

  await server.start()
  return { server }
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

  await server.start()
  return { server }
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

  await server.start()
  return { server }
}

let active: { server: { stop: () => Promise<void>; port: number; hostname: string } } | null = null

afterEach(async () => {
  if (active) {
    await active.server.stop()
    active = null
  }
})

describe.skipIf(!isBun)("FunnelGatewayServer auth integration", () => {
  test("/status returns 401 without bearer token", async () => {
    active = await startServer("secret-1")
    const url = `http://localhost:${active.server.port}/status`
    const res = await fetch(url)

    expect(res.status).toBe(401)
  })

  test("/status returns 200 with the correct bearer token", async () => {
    active = await startServer("secret-2")
    const url = `http://localhost:${active.server.port}/status`
    const res = await fetch(url, {
      headers: { authorization: "Bearer secret-2" },
    })

    expect(res.status).toBe(200)
  })

  test("/status returns 401 with the wrong bearer token", async () => {
    active = await startServer("secret-3")
    const url = `http://localhost:${active.server.port}/status`
    const res = await fetch(url, {
      headers: { authorization: "Bearer nope" },
    })

    expect(res.status).toBe(401)
  })

  test("/health stays open without a token", async () => {
    active = await startServer("secret-4")
    const url = `http://localhost:${active.server.port}/health`
    const res = await fetch(url)

    expect(res.status).toBe(200)
  })

  test("/health reports the daemon funnelDir so a wrong-gateway-on-a-shared-port is detectable", async () => {
    active = await startServer("secret-dir")
    const url = `http://localhost:${active.server.port}/health`
    const res = await fetch(url)
    const body = JSON.parse(await res.text())

    expect(res.status).toBe(200)
    expect(body.funnelDir).toBe("/funnel")
  })

  test("/ws upgrade is rejected with 404 for a channel this gateway does not know", async () => {
    // Before the fix the upgrade succeeded for any channel and then silently
    // delivered nothing — the wrong-gateway-on-a-shared-port symptom.
    active = await startServer("")
    const url = `http://localhost:${active.server.port}/ws?channel=ghost`
    const res = await fetch(url, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    })

    expect(res.status).toBe(404)
  })

  test("/listeners returns 401 without bearer token", async () => {
    active = await startServer("secret-5")
    const url = `http://localhost:${active.server.port}/listeners`
    const res = await fetch(url)

    expect(res.status).toBe(401)
  })

  test("/ws upgrade is rejected without the sub-protocol or bearer header", async () => {
    active = await startServer("secret-6")
    const url = `http://localhost:${active.server.port}/ws`
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
    const url = `ws://localhost:${active.server.port}/ws`

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
    const url = `http://localhost:${active.server.port}/ws`
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

describe.skipIf(!isBun)("FunnelGatewayServer extraRoutes", () => {
  test("host routes are mounted and answer requests", async () => {
    const extras = new Hono<Env>()
    extras.get("/extra/ping", (c) => c.text("pong"))
    active = await startServerWithExtras(extras)

    const url = `http://localhost:${active.server.port}/extra/ping`
    const res = await fetch(url)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("pong")
  })

  test("built-in routes still answer with extraRoutes mounted", async () => {
    const extras = new Hono<Env>()
    extras.get("/extra", (c) => c.text("extra"))
    active = await startServerWithExtras(extras)

    const url = `http://localhost:${active.server.port}/health`
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

    const url = `http://localhost:${active.server.port}/extra/clients`
    const res = await fetch(url)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ clients: 0 })
  })
})

describe.skipIf(!isBun)("FunnelGatewayServer event log", () => {
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

  test("stop() does not close an externally-injected event log", async () => {
    const fs = new MemoryFunnelFileSystem()
    const funnel = new Funnel({
      fs,
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
      tmpDir: "/tmp/funnel-test",
    })
    const eventLog = new TrackableEventLog()
    const server = funnel.gatewayServer({ port: 0, killCompetingSlack: false, token: "", eventLog })

    await server.start()
    await server.stop()

    expect(eventLog.closeCalled).toBe(false)
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

describe.skipIf(!isBun)("FunnelGatewayServer bind address", () => {
  test("binds to loopback by default", async () => {
    active = await startServerOn({ token: "secret" })

    expect(active.server.hostname).toBe("127.0.0.1")
  })

  test("refuses to start on a non-loopback bind without a token", async () => {
    await expect(startServerOn({ token: "", hostname: "0.0.0.0" })).rejects.toThrow(
      /reachable off-box but no token/,
    )
  })

  test("starts on a non-loopback bind when allowInsecureHost is set", async () => {
    active = await startServerOn({ token: "", hostname: "0.0.0.0", allowInsecureHost: true })

    expect(active.server.hostname).toBe("0.0.0.0")
  })

  test("starts on a non-loopback bind with a token", async () => {
    active = await startServerOn({ token: "secret", hostname: "0.0.0.0" })

    expect(active.server.hostname).toBe("0.0.0.0")
  })

  test("starts on a loopback bind even without a token", async () => {
    active = await startServerOn({ token: "" })

    expect(active.server.hostname).toBe("127.0.0.1")
  })
})

describe.skipIf(!isBun)("FunnelGatewayServer error responses", () => {
  const startWithChannel = async () => {
    const fs = new MemoryFunnelFileSystem()
    const funnel = new Funnel({
      fs,
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
      tmpDir: "/tmp/funnel-test",
    })
    funnel.channels.add({ name: "ops" })
    const server = funnel.gatewayServer({
      port: 0,
      killCompetingSlack: false,
      token: "secret",
      dbPath: "/tmp/funnel-test/events.db",
    })

    await server.start()
    return { server }
  }

  test("a service error surfaces its message instead of a generic 500", async () => {
    active = await startWithChannel()
    const url = `http://localhost:${active.server.port}/channels/ops/connectors/nope/call`

    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({ method: "GET", path: "x" }),
    })
    const text = await res.text()

    // channels.call throws a plain Error for the unknown connector; onError must
    // carry its message through rather than collapsing it to "Internal Server Error".
    expect(res.status).toBe(500)
    expect(text).toContain("not found")
    expect(text).not.toContain("Internal Server Error")
  })

  test("a body-validation HTTPException keeps its native 400", async () => {
    active = await startWithChannel()
    const url = `http://localhost:${active.server.port}/channels/ops/connectors/nope/call`

    const res = await fetch(url, {
      method: "POST",
      headers: { authorization: "Bearer secret", "content-type": "application/json" },
      body: JSON.stringify({}),
    })
    const text = await res.text()

    // The call route throws HTTPException(400) before reaching the service.
    // onError must delegate to its native response: the body carries the
    // validation reason verbatim, not the generic `{ error }` envelope the
    // non-HTTPException branch would emit.
    expect(res.status).toBe(400)
    expect(text).toContain("Invalid input")
  })
})
