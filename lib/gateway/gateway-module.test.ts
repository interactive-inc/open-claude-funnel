import { afterEach, describe, expect, spyOn, test } from "bun:test"

const isBun = typeof globalThis.Bun !== "undefined"
import type { Server } from "bun"
import { Hono } from "hono"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import type { FunnelGatewayModule, GatewayWsData } from "@/gateway/gateway-module"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { Funnel } from "@/funnel"

/**
 * Mounts a gateway module inside a Hono tree the *host* owns, served by a
 * `Bun.serve` the host owns. This is the embedding shape the module exists for:
 * funnel contributes routes and a websocket handler, the host contributes the
 * socket.
 */
const mountHost = async (
  options: {
    token: string
    channelName?: string
    /** Passed straight through to `gatewayModule`; undefined exercises the default. */
    healthRoute?: boolean
    /** Mount the gateway app before the host's own routes. Defaults to host-first. */
    gatewayFirst?: boolean
    /** Give the host its own `GET /health`, to exercise the collision with the built-in one. */
    hostHealth?: boolean
    rejectReplayOnce?: "zero" | "throw" | "read"
    onError?: (error: Error) => void
  } = { token: "" },
) => {
  const funnel = new Funnel({
    connectors: [scheduleConnector()],
    logger: new NoopFunnelLogger(),
    onError: options.onError,
  })

  if (options.channelName) funnel.channels.add({ name: options.channelName })

  const gw = funnel.gatewayModule({
    token: options.token,
    healthRoute: options.healthRoute,
    eventLog: new MemoryFunnelEventLog(),
  })

  const hostRoutes = new Hono()
  hostRoutes.get("/host/ping", (c) => c.text("host-pong"))
  if (options.hostHealth) hostRoutes.get("/health", (c) => c.json({ ok: true, owner: "host" }))

  const app = options.gatewayFirst
    ? new Hono().route("/", gw.app).route("/", hostRoutes)
    : new Hono().route("/", hostRoutes).route("/", gw.app)

  const fault = { remaining: options.rejectReplayOnce ?? null }
  const server: Server<GatewayWsData> = Bun.serve<GatewayWsData>({
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    fetch: (request, srv) => {
      const upgrade = gw.handleUpgrade(request, srv)

      if (upgrade.handled) return upgrade.response

      return app.fetch(request)
    },
    websocket: {
      ...gw.websocket,
      open(ws) {
        if (fault.remaining !== null) {
          const mode = fault.remaining
          fault.remaining = null
          if (mode === "read") {
            const replay = spyOn(gw.getBroadcaster(), "replayToClient").mockImplementationOnce(
              () => {
                throw new Error("replay read failed")
              },
            )
            try {
              gw.websocket.open?.(ws)
            } finally {
              replay.mockRestore()
            }
            return
          }
          const send = spyOn(ws, "send")
          if (mode === "zero") send.mockReturnValueOnce(0)
          else
            send.mockImplementationOnce(() => {
              throw new Error("replay send failed")
            })
          try {
            gw.websocket.open?.(ws)
          } finally {
            send.mockRestore()
          }
          return
        }
        gw.websocket.open?.(ws)
      },
    },
  })

  await gw.start()

  return { funnel, gw, server, port: server.port }
}

let active: { gw: FunnelGatewayModule; server: Server<GatewayWsData> } | null = null

afterEach(async () => {
  if (active) {
    await active.gw.stop()
    active.server.stop()
    active = null
  }
})

describe.skipIf(!isBun)("FunnelGatewayModule mounted in a host Hono app", () => {
  test("publishing to an unknown channel rejects before broadcast or persistence", async () => {
    const mounted = await mountHost({ token: "", channelName: "ops" })
    active = mounted
    const seen: string[] = []
    mounted.gw.onEvent((event) => seen.push(event.content))
    const response = await mounted.gw.app.request("/channels/typo/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "must not reach ops",
        meta: { channelId: mounted.funnel.channels.get("ops")?.id },
      }),
    })

    expect(response.status).toBe(404)
    expect(() => mounted.gw.emit({ channel: "typo", content: "also rejected" })).toThrow(
      "channel not found",
    )
    expect(seen).toEqual([])
    expect(mounted.gw.getEventLog().loadSince(0)).toEqual([])
    expect(mounted.gw.getBroadcaster().getMetrics().latestOffset).toBe(0)
  })

  test("raw broadcasts and emit persist once, before reentrant subscribers run", async () => {
    const mounted = await mountHost({ token: "", channelName: "ops" })
    active = mounted
    mounted.gw.onEvent((event) => {
      expect(
        mounted.gw
          .getEventLog()
          .loadSince(0)
          .some((row) => row.offset === event.offset),
      ).toBe(true)
      if (event.content === "raw") mounted.gw.emit({ channel: "ops", content: "nested" })
    })
    mounted.gw.getBroadcaster().broadcast("raw")
    expect(
      mounted.gw
        .getEventLog()
        .loadSince(0)
        .map((row) => row.content),
    ).toEqual(["raw", "nested"])
  })

  test("raw broadcasts persist offline exclusive assignments from current channel settings", async () => {
    const mounted = await mountHost({ token: "", channelName: "ops" })
    active = mounted
    mounted.funnel.channels.setDelivery("ops", "exclusive")
    const channel = mounted.funnel.channels.get("ops")
    if (!channel) throw new Error("expected channel")
    mounted.gw.getBroadcaster().broadcast("global")
    mounted.gw.getBroadcaster().broadcast("scoped", { channelId: channel.id })
    expect(
      mounted.gw
        .getEventLog()
        .loadSince(0)
        .map((row) => row.exclusive),
    ).toEqual([{ [channel.id]: null }, { [channel.id]: null }])
  })

  test("a connected client keeps receiving after a connector is renamed", async () => {
    const mounted = await mountHost({ token: "", channelName: "ops" })
    active = mounted
    mounted.funnel.channels.addConnector("ops", { type: "schedule", name: "old" })
    const received = await new Promise<string[]>((resolve, reject) => {
      const messages: string[] = []
      const ws = new WebSocket(`ws://localhost:${mounted.port}/ws?channel=ops`)
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error("rename delivery timed out"))
      }, 2000)
      ws.addEventListener("open", () => {
        mounted.gw.emit({ channel: "ops", connector: "old", content: "before" })
        mounted.funnel.channels.renameConnector("ops", "old", "new")
        mounted.gw.emit({ channel: "ops", connector: "new", content: "after" })
      })
      ws.addEventListener("message", (message) => {
        messages.push(JSON.parse(String(message.data)).content)
        if (messages.length !== 2) return
        clearTimeout(timeout)
        ws.close()
        resolve(messages)
      })
      ws.addEventListener("error", () => {
        clearTimeout(timeout)
        ws.close()
        reject(new Error("ws error"))
      })
    })

    expect(received).toEqual(["before", "after"])
  })

  test("exclusive replay rejects an anonymous worker instead of guessing its assignment", async () => {
    const mounted = await mountHost({ token: "", channelName: "ops" })
    active = mounted
    mounted.funnel.channels.setDelivery("ops", "exclusive")
    const upgrade = mounted.gw.handleUpgrade(
      new Request(`http://localhost:${mounted.port}/ws?channel=ops&since=0`, {
        headers: { upgrade: "websocket" },
      }),
      mounted.server,
    )
    expect(upgrade.handled).toBe(true)
    expect(upgrade.response?.status).toBe(400)
  })

  test("host routes and gateway routes coexist on the host's server", async () => {
    const mounted = await mountHost({ token: "" })
    active = mounted

    const host = await fetch(`http://localhost:${mounted.port}/host/ping`)
    const health = await fetch(`http://localhost:${mounted.port}/health`)

    expect(host.status).toBe(200)
    expect(await host.text()).toBe("host-pong")
    expect(health.status).toBe(200)

    const healthBody = (await health.json()) as { funnelDir: string }

    expect(healthBody.funnelDir).toBeUndefined()
  })

  test("healthRoute: false drops /health while the rest of the table stays mounted", async () => {
    const mounted = await mountHost({ token: "", healthRoute: false })
    active = mounted

    const health = await fetch(`http://localhost:${mounted.port}/health`)
    const status = await fetch(`http://localhost:${mounted.port}/status`)
    const listeners = await fetch(`http://localhost:${mounted.port}/listeners`)
    const debug = await fetch(`http://localhost:${mounted.port}/debug`)

    expect(health.status).toBe(404)
    expect(status.status).toBe(200)
    expect(listeners.status).toBe(200)
    expect(debug.status).toBe(200)
  })

  test("healthRoute: false lets the host own /health regardless of mount order", async () => {
    // The point of the flag: with the built-in route present, only "host app
    // mounted first" keeps the host's /health reachable — an implicit ordering
    // condition. Mounting the gateway first proves the condition is gone.
    const mounted = await mountHost({
      token: "",
      healthRoute: false,
      hostHealth: true,
      gatewayFirst: true,
    })
    active = mounted

    const res = await fetch(`http://localhost:${mounted.port}/health`)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, owner: "host" })
  })

  test("healthRoute: false leaves the host's /health unauthenticated while /status still needs a token", async () => {
    // Gateway auth is mounted by path prefix and never covered /health, so
    // opting out must not drag the host's own probe endpoint behind the token.
    const mounted = await mountHost({
      token: "module-secret",
      healthRoute: false,
      hostHealth: true,
      gatewayFirst: true,
    })
    active = mounted

    const health = await fetch(`http://localhost:${mounted.port}/health`)
    const status = await fetch(`http://localhost:${mounted.port}/status`)

    expect(health.status).toBe(200)
    expect(await health.json()).toEqual({ ok: true, owner: "host" })
    expect(status.status).toBe(401)
  })

  test("omitting healthRoute keeps the built-in /health, even mounted before the host's", async () => {
    const mounted = await mountHost({ token: "", hostHealth: true, gatewayFirst: true })
    active = mounted

    const res = await fetch(`http://localhost:${mounted.port}/health`)
    const body = (await res.json()) as { funnelDir?: string }

    expect(res.status).toBe(200)
    expect(body.funnelDir).toBeUndefined()
  })

  test("token auth still guards gateway routes when mounted by a host", async () => {
    const mounted = await mountHost({ token: "module-secret" })
    active = mounted

    const without = await fetch(`http://localhost:${mounted.port}/status`)
    const wrong = await fetch(`http://localhost:${mounted.port}/status`, {
      headers: { authorization: "Bearer nope" },
    })
    const right = await fetch(`http://localhost:${mounted.port}/status`, {
      headers: { authorization: "Bearer module-secret" },
    })

    expect(without.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(right.status).toBe(200)
  })

  test("host routes stay open even while gateway routes require a token", async () => {
    const mounted = await mountHost({ token: "module-secret" })
    active = mounted

    const res = await fetch(`http://localhost:${mounted.port}/host/ping`)

    expect(res.status).toBe(200)
  })

  test("a successful /ws upgrade is not answered by the host app", async () => {
    // The three-state upgrade result exists for exactly this: `handled: true`
    // with an undefined response means Bun owns the socket now. Collapsing it
    // to a nullable Response would fall through to app.fetch and write a 404
    // body onto an already-upgraded connection.
    const mounted = await mountHost({ token: "ws-secret", channelName: "ops" })
    active = mounted

    const received = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://localhost:${mounted.port}/ws?channel=ops`, [
        "funnel.token.ws-secret",
      ])
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error("timeout waiting for broadcast"))
      }, 2000)

      ws.addEventListener("open", () => {
        mounted.gw.emit({ channel: "ops", content: "mounted-hello" })
      })
      ws.addEventListener("message", (event) => {
        clearTimeout(timeout)
        ws.close()
        resolve(String(event.data))
      })
      ws.addEventListener("error", () => {
        clearTimeout(timeout)
        reject(new Error("ws error"))
      })
    })

    expect(JSON.parse(received).content).toBe("mounted-hello")
  })

  test("/ws upgrade is rejected without the token", async () => {
    const mounted = await mountHost({ token: "ws-secret", channelName: "ops" })
    active = mounted

    const res = await fetch(`http://localhost:${mounted.port}/ws?channel=ops`, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    })

    expect(res.status).toBe(401)
  })

  test("/ws upgrade is rejected for a channel this gateway does not know", async () => {
    const mounted = await mountHost({ token: "", channelName: "ops" })
    active = mounted

    const res = await fetch(`http://localhost:${mounted.port}/ws?channel=ghost`, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    })

    expect(res.status).toBe(404)
  })

  test("a non-/ws request is reported as unhandled so the host can route it", async () => {
    const mounted = await mountHost({ token: "" })
    active = mounted

    // /host/ping only answers because handleUpgrade declined it; a module that
    // claimed every request would swallow the host's own route tree.
    const res = await fetch(`http://localhost:${mounted.port}/host/ping`)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("host-pong")
  })
})

describe.skipIf(!isBun)("FunnelGatewayModule lifecycle", () => {
  test("start() boots the configured listeners and stop() clears them", async () => {
    const funnel = new Funnel({
      logger: new NoopFunnelLogger(),

      connectors: [scheduleConnector()],
    })
    const channel = funnel.channels.add({ name: "ops" })
    funnel.channels.addConnector("ops", {
      type: "schedule",
      name: "tick",
      cron: "0 0 * * *",
      prompt: "tick",
    })

    const gw = funnel.gatewayModule({
      token: "",
      eventLog: new MemoryFunnelEventLog(),
    })

    await gw.start()

    // list() enumerates the running listeners, so a booted schedule connector
    // must appear and a stopped one must not.
    expect(
      gw
        .getRegistry()
        .list()
        .map((entry) => entry.name),
    ).toEqual(["tick"])
    expect(gw.getRegistry().list()[0]?.channelId).toBe(channel.id)

    await gw.stop()

    expect(gw.getRegistry().list()).toEqual([])
  })

  test("stop() leaves an externally-injected event log open", async () => {
    const funnel = new Funnel({
      logger: new NoopFunnelLogger(),
    })
    funnel.channels.add({ name: "ops" })
    const eventLog = new MemoryFunnelEventLog()
    const gw = funnel.gatewayModule({ token: "", eventLog })

    await gw.start()
    gw.emit({ channel: "ops", content: "kept" })
    await gw.stop()

    // A closed log would throw or lose the record; the host owns this one.
    expect(eventLog.loadSince(0).map((event) => event.content)).toEqual(["kept"])
  })

  test("start() after stop() is refused instead of running on a closed event log", async () => {
    // A disposed module must never restart on its closed replay log.
    const funnel = new Funnel({
      logger: new NoopFunnelLogger(),
    })
    funnel.channels.add({ name: "ops" })
    const gw = funnel.gatewayModule({
      token: "",
    })

    await gw.start()
    await gw.stop()

    await expect(gw.start()).rejects.toThrow(/single-use/)
  })

  test("uptime is measured from the attempt that succeeded, not an earlier failed one", async () => {
    // The pre-split server re-stamped on every start(). A first-call-wins stamp
    // would make a retry after a rolled-back boot report uptime that includes
    // the failed interval.
    const clock = new MemoryFunnelClock({ start: new Date("2026-01-01T00:00:00Z") })
    const funnel = new Funnel({
      logger: new NoopFunnelLogger(),
      clock,
    })
    funnel.channels.add({ name: "ops" })
    const gw = funnel.gatewayModule({
      token: "",
      eventLog: new MemoryFunnelEventLog(),
    })

    await gw.start()

    clock.advance(5_000)

    // A host that rolled back its bind may call start() again on the same
    // module; uptime must restart from here.
    await gw.start()

    const res = await gw.app.request("/status")
    const body = (await res.json()) as { uptimeMs: number }

    expect(body.uptimeMs).toBe(0)

    await gw.stop()
  })

  test("emit() and onEvent() work without any server bound at all", () => {
    const funnel = new Funnel({
      logger: new NoopFunnelLogger(),
    })
    const channel = funnel.channels.add({ name: "ops" })
    const eventLog = new MemoryFunnelEventLog()
    const gw = funnel.gatewayModule({ token: "", eventLog })

    const observed: (string | undefined)[] = []
    gw.onEvent((event) => observed.push(event.meta?.channelId))

    gw.emit({ channel: "ops", content: "a" })
    gw.emit({ channel: channel.id, content: "b" })

    expect(observed).toEqual([channel.id, channel.id])
    expect(gw.getEventLog()).toBe(eventLog)
  })
})

describe.skipIf(!isBun)("FunnelGatewayServer over the module", () => {
  test("exposes the module it hosts", async () => {
    const funnel = new Funnel({
      logger: new NoopFunnelLogger(),
    })
    const eventLog = new MemoryFunnelEventLog()
    const server = funnel.gatewayServer({
      port: 0,

      token: "",
      eventLog,
    })

    await server.start()

    try {
      expect(server.getModule().getEventLog()).toBe(eventLog)
      expect(server.getModule().getBroadcaster()).toBe(server.getBroadcaster())
    } finally {
      await server.stop()
    }
  })
})

for (const mode of ["zero", "throw", "read"] satisfies ReadonlyArray<"zero" | "throw" | "read">) {
  test(`failed replay closes the WebSocket and allows replay from the accepted offset (${mode})`, async () => {
    const failures: Error[] = []
    const mounted = await mountHost({
      token: "",
      channelName: "ops",
      rejectReplayOnce: mode,
      onError: (error) => failures.push(error),
    })
    active = mounted
    mounted.gw.emit({ channel: "ops", content: "missed schedule" })
    const clients: WebSocket[] = []
    try {
      const closed = Promise.withResolvers<boolean>()
      const first = new WebSocket(`ws://127.0.0.1:${mounted.port}/ws?channel=ops&since=0`)
      clients.push(first)
      first.addEventListener("close", () => closed.resolve(true))
      first.addEventListener("error", () => {})
      const closeLimit = setTimeout(() => closed.resolve(false), 1000)
      const wasClosed = await closed.promise
      clearTimeout(closeLimit)
      expect(wasClosed).toBe(true)
      expect(mounted.gw.getBroadcaster().getClientCount()).toBe(0)
      expect(failures).toHaveLength(1)
      const received = Promise.withResolvers<string>()
      const second = new WebSocket(`ws://127.0.0.1:${mounted.port}/ws?channel=ops&since=0`)
      clients.push(second)
      second.addEventListener("message", (event) => received.resolve(String(event.data)))
      second.addEventListener("error", () => received.reject(new Error("reconnect failed")))
      const receiveLimit = setTimeout(() => received.reject(new Error("replay timed out")), 1000)
      try {
        expect(JSON.parse(await received.promise)).toMatchObject({
          offset: 1,
          content: "missed schedule",
        })
      } finally {
        clearTimeout(receiveLimit)
      }
    } finally {
      for (const client of clients) client.close()
    }
  })
}
