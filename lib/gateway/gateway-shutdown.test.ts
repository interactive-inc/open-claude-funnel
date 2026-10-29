import { expect, test } from "bun:test"
import { Hono } from "hono"
import { Funnel } from "@/funnel"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import type { GatewayWsData } from "@/gateway/gateway-module"

const setup = async (slowStop = false) => {
  const state = { starts: 0, calls: 0 }
  const closing = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const socketCloses: { code: number; reason: string }[] = []
  class Listener extends FunnelConnectorListener {
    async start(): Promise<void> {
      state.starts++
    }
    async stop(): Promise<void> {
      closing.resolve()
      if (slowStop) await release.promise
    }
  }
  const descriptor: ConnectorDescriptor = {
    type: "test",
    toolExposed: true,
    secretTokens: () => [],
    operations: {},
    buildConfig: (input, context) => ({ id: context.id, name: String(input.name), type: "test" }),
    applyUpdate: (config) => config,
    createListener: () => new Listener(),
    createAdapter: () => ({
      call: async () => {
        state.calls++
        return null
      },
    }),
  }
  const gateway = new Funnel({
    connectors: [descriptor],
    channels: [{ name: "ops", connectors: [{ type: "test", name: "events" }] }],
  }).gatewayModule({ token: "example-token", healthRoute: false })
  const app = new Hono()
    .route("/", gateway.app)
    .get("/host/ping", (context) => context.text("host"))
    .get("/health", (context) => context.text("host health"))
  const server = Bun.serve<GatewayWsData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, host) {
      const upgrade = gateway.handleUpgrade(request, host)
      if (upgrade.handled) return upgrade.response
      return app.fetch(request)
    },
    websocket: {
      ...gateway.websocket,
      close(socket, code, reason) {
        socketCloses.push({ code, reason })
        gateway.websocket.close?.(socket, code, reason)
      },
    },
  })
  await gateway.start()
  return { gateway, server, state, closing, release, socketCloses }
}

test.each(["stopping", "stopped"])(
  "a %s gateway rejects new operations while host routes remain available",
  async (phase) => {
    const context = await setup(phase === "stopping")
    const stopping = context.gateway.stop()
    try {
      if (phase === "stopping") await context.closing.promise
      else await stopping
      const base = `http://127.0.0.1:${context.server.port}`
      const response = await fetch(`${base}/listeners/ops/events/start`, {
        method: "POST",
        headers: { authorization: "Bearer example-token" },
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ ok: false, reason: "gateway is stopped" })
      expect(context.state.starts).toBe(1)
      expect((await fetch(`${base}/host/ping`)).status).toBe(200)
      expect((await fetch(`${base}/health`)).status).toBe(200)
      expect(
        (await fetch(`${base}/status`, { headers: { authorization: "Bearer example-token" } }))
          .status,
      ).toBe(503)
      const upgrade = await fetch(`${base}/ws?channel=ops`, {
        headers: {
          authorization: "Bearer example-token",
          upgrade: "websocket",
          connection: "Upgrade",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-version": "13",
        },
      })
      expect(upgrade.status).toBe(503)
      expect((await fetch(`${base}/listeners/ops/events/start`, { method: "POST" })).status).toBe(
        401,
      )
      for (const route of [
        "/listeners/ops/events/restart",
        "/channels/ops/publish",
        "/channels/ops/connectors/events/call",
      ]) {
        expect(
          (
            await fetch(`${base}${route}`, {
              method: "POST",
              headers: {
                authorization: "Bearer example-token",
                "content-type": "application/json",
              },
              body: '{"content":"ignored","method":"POST","path":"resource"}',
            })
          ).status,
        ).toBe(503)
      }
      expect(context.state.calls).toBe(0)
    } finally {
      context.release.resolve()
      await stopping
      await context.gateway.getRegistry().stopAll()
      context.server.stop(true)
    }
  },
)

test("a disposed gateway seals previously obtained registry handles", async () => {
  const context = await setup()
  const registry = context.gateway.getRegistry()
  try {
    const stopping = context.gateway.stop()
    expect((await registry.start("ops", "events")).ok).toBe(false)
    await stopping
    expect((await registry.restart("ops", "events")).ok).toBe(false)
    await registry.startAll()
    expect(context.state.starts).toBe(1)
    expect(registry.list()).toEqual([])
  } finally {
    await context.gateway.stop()
    context.server.stop(true)
  }
})

test("shutdown discards queued native input before slow source cleanup finishes", async () => {
  const context = await setup(true)
  const events = context.gateway.events({ channel: "ops" })
  context.gateway.emit({ channel: "ops", content: "discard on shutdown" })
  const stopping = context.gateway.stop()
  try {
    await context.closing.promise
    expect((await events.next()).done).toBe(true)
  } finally {
    context.release.resolve()
    await stopping
    context.server.stop(true)
  }
})

test("module shutdown closes its WebSockets while the host server remains available", async () => {
  const context = await setup()
  const socket = new WebSocket(`ws://127.0.0.1:${context.server.port}/ws?channel=ops`, [
    "funnel.token.example-token",
  ])
  const closed = Promise.withResolvers<{ code: number; reason: string }>()
  socket.onclose = (event) => closed.resolve({ code: event.code, reason: event.reason })
  const deadline = Promise.withResolvers<never>()
  const timer = setTimeout(() => deadline.reject(new Error("shutdown left a WebSocket open")), 1000)
  try {
    await Promise.race([
      new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve()
        socket.onerror = () => reject(new Error("handshake failed"))
      }),
      deadline.promise,
    ])
    await context.gateway.stop()
    const closure = await Promise.race([closed.promise, deadline.promise])
    expect(closure.reason).toBe("gateway stopped")
    // Bun's client reports 1000 for a server-originated 1001; verify both boundaries.
    expect([1000, 1001]).toContain(closure.code)
    expect(context.socketCloses).toContainEqual({ code: 1001, reason: "gateway stopped" })
    expect(context.gateway.getStatus().clients).toBe(0)
    expect((await fetch(`http://127.0.0.1:${context.server.port}/host/ping`)).status).toBe(200)
  } finally {
    clearTimeout(timer)
    socket.close()
    await context.gateway.stop()
    context.server.stop(true)
  }
})

test("a stopped gateway cannot perform an outbound call after reading a delayed request body", async () => {
  const context = await setup()
  const reading = Promise.withResolvers<void>()
  const releaseBody = Promise.withResolvers<void>()
  const body = new ReadableStream(
    {
      async pull(controller) {
        reading.resolve()
        await releaseBody.promise
        controller.enqueue(new TextEncoder().encode('{"method":"POST","path":"resource"}'))
        controller.close()
      },
    },
    { highWaterMark: 0 },
  )
  const request = context.gateway.app.request("/channels/ops/connectors/events/call", {
    method: "POST",
    headers: { authorization: "Bearer example-token", "content-type": "application/json" },
    body,
  })
  try {
    await reading.promise
    await context.gateway.stop()
    releaseBody.resolve()
    expect((await request).status).toBe(503)
    expect(context.state.calls).toBe(0)
  } finally {
    releaseBody.resolve()
    await context.gateway.stop()
    context.server.stop(true)
  }
})
