import { expect, test } from "bun:test"
import type { GatewayWsData } from "@/gateway/gateway-module"
import { Funnel } from "@/funnel"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"

/** Real loopback sockets with deterministic storage and transport failures. */
const failedReplay = async (
  failure:
    | "read"
    | "send"
    | "dropped"
    | "backpressure"
    | "unprintable-read"
    | "unprintable-send"
    | "async-page"
    | "invalid-page",
  failingReporters = false,
) => {
  const reported: Error[] = []
  const escaped: unknown[] = []
  class Logger extends MemoryFunnelLogger {
    override warn(): void {
      throw new Error("logger unavailable")
    }
  }
  const funnel = new Funnel({
    logger: failingReporters ? new Logger() : undefined,
    channels: [{ name: "ops" }],
    onError: (error) => {
      reported.push(error)
      if (failingReporters) throw new Error("reporter unavailable")
    },
  })
  const channel = funnel.channels.get("ops")!
  const log = new MemoryFunnelEventLog()
  log.record({
    offset: 1,
    content: "retained",
    channelId: channel.id,
    connectorId: null,
    meta: { channelId: channel.id },
  })
  const gateway = funnel.gatewayModule({ token: "", eventLog: log })
  if (failure === "read" || failure === "unprintable-read")
    log.loadSince = () => {
      if (failure === "unprintable-read") throw Object.create(null)
      throw new Error("replay read failed")
    }
  if (failure === "async-page")
    log.loadSince = () => Promise.reject(new Error("replay storage unavailable")) as never
  if (failure === "invalid-page") log.loadSince = () => ({ length: 0 }) as never
  const server = Bun.serve<GatewayWsData>({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request, host) {
      const upgrade = gateway.handleUpgrade(request, host)
      if (upgrade.handled) return upgrade.response
      return new Response("not found", { status: 404 })
    },
    websocket: {
      ...gateway.websocket,
      open(socket) {
        if (failure === "dropped") socket.send = () => 0
        if (failure === "backpressure") socket.getBufferedAmount = () => 10_000_000
        if (failure === "send" || failure === "unprintable-send")
          socket.send = () => {
            if (failure === "unprintable-send") throw Object.create(null)
            throw new Error("replay send failed")
          }
        // The host boundary must not need to catch Funnel replay errors.
        try {
          gateway.websocket.open?.(socket)
        } catch (error) {
          escaped.push(error)
          socket.close(1011, "escaped replay error")
        }
      },
    },
  })
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?channel=ops&since=0`)
  try {
    const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("failed replay left socket open")), 1000)
      socket.onclose = (event) => {
        clearTimeout(timeout)
        resolve({ code: event.code, reason: event.reason })
      }
      socket.onerror = () => {
        clearTimeout(timeout)
        reject(new Error("WebSocket handshake failed"))
      }
    })
    expect(escaped).toEqual([])
    await Bun.sleep(0)
    expect(reported).toHaveLength(failure === "async-page" ? 2 : 1)
    if (failure === "async-page" || failure === "invalid-page") {
      expect(reported.map((error) => error.message)).toContain(
        "event log replay must return an array synchronously",
      )
      if (failure === "async-page")
        expect(reported.map((error) => error.message)).toContain("replay storage unavailable")
    }
    if (failure === "read" || failure === "send")
      expect(reported[0]?.message).toBe(`replay ${failure} failed`)
    if (failure === "unprintable-read" || failure === "unprintable-send")
      expect(reported[0]?.message).toBe("Unprintable thrown value")
    if (failure === "backpressure") expect(closed).toEqual({ code: 1009, reason: "backpressure" })
    else expect(closed).toEqual({ code: 1011, reason: "replay failed" })
    expect(gateway.getStatus().clients).toBe(0)
  } finally {
    socket.close()
    await gateway.stop()
    server.stop(true)
    log.close()
  }
}

test("WebSocket replay read failure is reported and closes the failed subscription", async () => {
  await failedReplay("read")
})

for (const failure of [
  "unprintable-read",
  "unprintable-send",
  "async-page",
  "invalid-page",
] as const) {
  for (const failingReporters of [false, true]) {
    test(`${failure} closes the real socket without escaping (reporters fail=${failingReporters})`, async () => {
      await failedReplay(failure, failingReporters)
    })
  }
}

test("failed replay reporting cannot escape the host WebSocket callback", async () => {
  await failedReplay("read", true)
})

test("WebSocket replay send failure closes instead of leaving an orphan connection", async () => {
  await failedReplay("send")
})

test.each(["dropped", "backpressure"] as const)(
  "WebSocket replay stops on %s rather than silently continuing",
  async (failure) => {
    await failedReplay(failure)
  },
)

test("a WebSocket receives retained input before continuing with live input", async () => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayServer({ port: 0, token: "" })
  await gateway.start()
  gateway.emit({ channel: "ops", content: "retained" })
  const socket = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws?channel=ops&since=0`)
  try {
    const received = await new Promise<unknown[]>((resolve, reject) => {
      const messages: unknown[] = []
      const timeout = setTimeout(() => reject(new Error("replay delivery timed out")), 1000)
      socket.onopen = () => {
        gateway.emit({ channel: "ops", content: "live" })
      }
      socket.onmessage = (message) => {
        messages.push(JSON.parse(String(message.data)))
        if (messages.length !== 2) return
        clearTimeout(timeout)
        resolve(messages)
      }
      socket.onerror = () => {
        clearTimeout(timeout)
        reject(new Error("WebSocket handshake failed"))
      }
    })
    expect(received).toMatchObject([
      { offset: 1, content: "retained" },
      { offset: 2, content: "live" },
    ])
  } finally {
    socket.close()
    await gateway.stop()
  }
})
