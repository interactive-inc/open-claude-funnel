import { describe, expect, test, vi } from "vitest"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  type ChannelOffsetPort,
  FunnelChannelSubscriber,
} from "@/engine/mcp/channel-subscriber"

type Listener = (event: { data: string }) => void

class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  static reset(): void {
    FakeWebSocket.instances = []
  }

  readonly url: string
  readonly protocols: string[] | undefined
  private readonly listeners: Map<string, Listener[]> = new Map()

  constructor(url: string, protocols?: string[]) {
    this.url = url
    this.protocols = protocols
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const list = this.listeners.get(type) ?? []

    list.push(listener)
    this.listeners.set(type, list)
  }

  emit(type: string, event: { data: string }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

const buildServer = (): { server: Server; sent: unknown[] } => {
  const sent: unknown[] = []
  const server = {
    notification: vi.fn(async (payload: unknown) => {
      sent.push(payload)
    }),
  } as unknown as Server

  return { server, sent }
}

const buildPort = (initial: number): { port: ChannelOffsetPort; saves: number[] } => {
  const saves: number[] = []
  const port: ChannelOffsetPort = {
    load: () => initial,
    save: (offset) => {
      saves.push(offset)
    },
  }

  return { port, saves }
}

describe("FunnelChannelSubscriber", () => {
  test("first connect includes ?since=<persisted offset> when an offset has been saved", () => {
    FakeWebSocket.reset()
    const { server } = buildServer()
    const { port } = buildPort(42)
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: undefined,
      offsetPort: port,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()

    expect(FakeWebSocket.instances[0]?.url).toBe("ws://gateway/ws?channel=ch1&since=42")
  })

  test("first connect omits since when no offset has been saved", () => {
    FakeWebSocket.reset()
    const { server } = buildServer()
    const { port } = buildPort(0)
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: undefined,
      offsetPort: port,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()

    expect(FakeWebSocket.instances[0]?.url).toBe("ws://gateway/ws?channel=ch1")
  })

  test("receiving an event with a higher offset persists it via the port", async () => {
    FakeWebSocket.reset()
    const { server, sent } = buildServer()
    const { port, saves } = buildPort(0)
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: undefined,
      offsetPort: port,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()
    const ws = FakeWebSocket.instances[0]

    if (!ws) throw new Error("expected a WebSocket")

    ws.emit("message", {
      data: JSON.stringify({ content: "hello", meta: { event_type: "slack" }, offset: 7 }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(saves).toEqual([7])
    expect(sent).toHaveLength(1)
  })

  test("forwarded notification meta carries the event offset as a string", async () => {
    FakeWebSocket.reset()
    const { server, sent } = buildServer()
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: undefined,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()
    const ws = FakeWebSocket.instances[0]

    if (!ws) throw new Error("expected a WebSocket")

    ws.emit("message", {
      data: JSON.stringify({
        content: "hi",
        meta: { event_type: "slack", channel_id: "C1" },
        offset: 11,
      }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    const last = sent[0] as { params: { meta: Record<string, string> } }

    expect(last.params.meta.offset).toBe("11")
    expect(last.params.meta.channel_id).toBe("C1")
  })

  test("out-of-order or duplicate offsets do not move the persisted cursor backward", async () => {
    FakeWebSocket.reset()
    const { server } = buildServer()
    const { port, saves } = buildPort(10)
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: undefined,
      offsetPort: port,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()
    const ws = FakeWebSocket.instances[0]

    if (!ws) throw new Error("expected a WebSocket")

    ws.emit("message", {
      data: JSON.stringify({ content: "old", meta: {}, offset: 5 }),
    })
    ws.emit("message", {
      data: JSON.stringify({ content: "new", meta: {}, offset: 12 }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(saves).toEqual([12])
  })

  test("reconnect uses the latest known offset, not the original persisted value", () => {
    FakeWebSocket.reset()
    const { server } = buildServer()
    const { port } = buildPort(0)
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: undefined,
      offsetPort: port,
      reconnectDelay: 0,
      reconnectScheduler: (cb) => {
        cb()
        return 0
      },
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()
    const first = FakeWebSocket.instances[0]

    if (!first) throw new Error("expected first WebSocket")

    first.emit("message", {
      data: JSON.stringify({ content: "x", meta: {}, offset: 9 }),
    })
    first.emit("close", { data: "" })

    expect(FakeWebSocket.instances[1]?.url).toBe("ws://gateway/ws?channel=ch1&since=9")
  })
})
