import { afterEach, describe, expect, test } from "bun:test"

const isBun = typeof globalThis.Bun !== "undefined"
import type { Server } from "bun"
import { Hono } from "hono"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import type { FunnelGatewayModule, GatewayWsData } from "@/gateway/gateway-module"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { slackConnector } from "@/engine/connectors/slack-connector"
import { Funnel } from "@/funnel"

/**
 * Mounts a gateway module inside a Hono tree the *host* owns, served by a
 * `Bun.serve` the host owns. This is the embedding shape the module exists for:
 * funnel contributes routes and a websocket handler, the host contributes the
 * socket.
 */
const mountHost = async (options: { token: string; channelName?: string } = { token: "" }) => {
  const funnel = new Funnel({
    fs: new MemoryFunnelFileSystem(),
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
    tmpDir: "/tmp/funnel-module-test",
  })

  if (options.channelName) funnel.channels.add({ name: options.channelName })

  const gw = funnel.gatewayModule({
    killCompetingSlack: false,
    token: options.token,
    eventLog: new MemoryFunnelEventLog(),
  })

  const hostRoutes = new Hono()
  hostRoutes.get("/host/ping", (c) => c.text("host-pong"))

  const app = new Hono().route("/", hostRoutes).route("/", gw.app)

  const server: Server<GatewayWsData> = Bun.serve<GatewayWsData>({
    port: 0,
    hostname: "127.0.0.1",
    development: false,
    fetch: (request, srv) => {
      const upgrade = gw.handleUpgrade(request, srv)

      if (upgrade.handled) return upgrade.response

      return app.fetch(request)
    },
    websocket: gw.websocket,
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
  test("host routes and gateway routes coexist on the host's server", async () => {
    const mounted = await mountHost({ token: "" })
    active = mounted

    const host = await fetch(`http://localhost:${mounted.port}/host/ping`)
    const health = await fetch(`http://localhost:${mounted.port}/health`)

    expect(host.status).toBe(200)
    expect(await host.text()).toBe("host-pong")
    expect(health.status).toBe(200)

    const healthBody = (await health.json()) as { funnelDir: string }

    expect(healthBody.funnelDir).toBe("/funnel")
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
      fs: new MemoryFunnelFileSystem(),
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
      tmpDir: "/tmp/funnel-module-test",
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
      killCompetingSlack: false,
      token: "",
      eventLog: new MemoryFunnelEventLog(),
    })

    await gw.start()

    // list() enumerates the running listeners, so a booted schedule connector
    // must appear and a stopped one must not.
    expect(gw.getRegistry().list().map((entry) => entry.name)).toEqual(["tick"])
    expect(gw.getRegistry().list()[0]?.channelId).toBe(channel.id)

    await gw.stop()

    expect(gw.getRegistry().list()).toEqual([])
  })

  test("stop() leaves an externally-injected event log open", async () => {
    const funnel = new Funnel({
      fs: new MemoryFunnelFileSystem(),
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
      tmpDir: "/tmp/funnel-module-test",
    })
    funnel.channels.add({ name: "ops" })
    const eventLog = new MemoryFunnelEventLog()
    const gw = funnel.gatewayModule({ killCompetingSlack: false, token: "", eventLog })

    await gw.start()
    gw.emit({ channel: "ops", content: "kept" })
    await gw.stop()

    // A closed log would throw or lose the record; the host owns this one.
    expect(eventLog.loadSince(0).map((event) => event.content)).toEqual(["kept"])
  })

  test("the Slack competitor scan runs once even if the host already ran it", async () => {
    // FunnelGatewayServer runs the kill before Bun.serve (a stale same-dir
    // daemon may hold the port) and then calls start(). Without the first-call-
    // wins guard, start() would hunt for competitors a second time with our own
    // socket already open.
    const process = new MemoryFunnelProcessRunner()
    let scans = 0
    process.onListProcessesContaining(() => {
      scans += 1
      return []
    })

    const funnel = new Funnel({
      fs: new MemoryFunnelFileSystem(),
      logger: new NoopFunnelLogger(),
      process,
      dir: "/funnel",
      tmpDir: "/tmp/funnel-module-test",
      connectors: [slackConnector()],
    })
    funnel.channels.add({ name: "ops" })
    funnel.channels.addConnector("ops", {
      type: "slack",
      name: "bot",
      botToken: "xoxb-test",
      appToken: "xapp-test",
    })

    const gw = funnel.gatewayModule({
      killCompetingSlack: true,
      token: "",
      eventLog: new MemoryFunnelEventLog(),
    })

    await gw.killCompetingSlackIfNeeded()
    await gw.killCompetingSlackIfNeeded()

    expect(scans).toBe(1)

    await gw.stop()
  })

  test("a no-op scan does not suppress a later real one", async () => {
    // The guard must mark that the sweep RAN, not that the method was called.
    // A host may call this before its own bind while the channel still has no
    // Slack connector; if that call set the flag, the connector added before
    // start() would never get its competitor swept and two Socket Mode
    // connections would share a token.
    const process = new MemoryFunnelProcessRunner()
    let scans = 0
    process.onListProcessesContaining(() => {
      scans += 1
      return []
    })

    const funnel = new Funnel({
      fs: new MemoryFunnelFileSystem(),
      logger: new NoopFunnelLogger(),
      process,
      dir: "/funnel",
      tmpDir: "/tmp/funnel-module-test",
      connectors: [slackConnector()],
    })
    funnel.channels.add({ name: "ops" })

    const gw = funnel.gatewayModule({
      killCompetingSlack: true,
      token: "",
      eventLog: new MemoryFunnelEventLog(),
    })

    // No Slack connector yet: nothing to sweep, and nothing recorded as swept.
    await gw.killCompetingSlackIfNeeded()

    expect(scans).toBe(0)

    funnel.channels.addConnector("ops", {
      type: "slack",
      name: "bot",
      botToken: "xoxb-test",
      appToken: "xapp-test",
    })

    await gw.killCompetingSlackIfNeeded()

    expect(scans).toBe(1)

    await gw.stop()
  })

  test("start() after stop() is refused instead of running on a closed event log", async () => {
    // emit() broadcasts before it records, so a restart on a disposed module
    // would deliver events live and silently drop them from the replay log.
    const funnel = new Funnel({
      fs: new MemoryFunnelFileSystem(),
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
      tmpDir: "/tmp/funnel-module-test",
    })
    funnel.channels.add({ name: "ops" })
    const gw = funnel.gatewayModule({
      killCompetingSlack: false,
      token: "",
      dbPath: "/tmp/funnel-module-test/restart.db",
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
      fs: new MemoryFunnelFileSystem(),
      logger: new NoopFunnelLogger(),
      clock,
      dir: "/funnel",
      tmpDir: "/tmp/funnel-module-test",
    })
    funnel.channels.add({ name: "ops" })
    const gw = funnel.gatewayModule({
      killCompetingSlack: false,
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
      fs: new MemoryFunnelFileSystem(),
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
      tmpDir: "/tmp/funnel-module-test",
    })
    const channel = funnel.channels.add({ name: "ops" })
    const eventLog = new MemoryFunnelEventLog()
    const gw = funnel.gatewayModule({ killCompetingSlack: false, token: "", eventLog })

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
      fs: new MemoryFunnelFileSystem(),
      logger: new NoopFunnelLogger(),
      dir: "/funnel",
      tmpDir: "/tmp/funnel-module-test",
    })
    const eventLog = new MemoryFunnelEventLog()
    const server = funnel.gatewayServer({
      port: 0,
      killCompetingSlack: false,
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
