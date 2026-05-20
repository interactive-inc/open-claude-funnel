import { describe, expect, test, vi } from "vitest"
import type { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelChannelOffsetStore } from "@/engine/mcp/channel-offset-store"
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
      protocols: null,
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
      protocols: null,
      offsetPort: port,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()

    expect(FakeWebSocket.instances[0]?.url).toBe("ws://gateway/ws?channel=ch1")
  })

  test("a notification failure does not advance the persisted offset", async () => {
    FakeWebSocket.reset()
    const { port, saves } = buildPort(0)
    const failing = vi.fn(async () => {
      throw new Error("stdio closed")
    })
    const subscriber = new FunnelChannelSubscriber({
      server: { notification: failing } as unknown as Server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: null,
      offsetPort: port,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()
    const ws = FakeWebSocket.instances[0]

    if (!ws) throw new Error("expected a WebSocket")

    ws.emit("message", {
      data: JSON.stringify({ content: "x", meta: {}, offset: 17 }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(failing).toHaveBeenCalled()
    expect(saves).toEqual([])
  })

  test("an FS error from offsetPort.save is swallowed and the next event still notifies", async () => {
    FakeWebSocket.reset()
    const { server, sent } = buildServer()
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: null,
      offsetPort: {
        load: () => 0,
        save: () => {
          throw new Error("EACCES")
        },
      },
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()
    const ws = FakeWebSocket.instances[0]

    if (!ws) throw new Error("expected a WebSocket")

    ws.emit("message", {
      data: JSON.stringify({ content: "first", meta: {}, offset: 4 }),
    })
    ws.emit("message", {
      data: JSON.stringify({ content: "second", meta: {}, offset: 5 }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent).toHaveLength(2)
  })

  test("a malformed JSON frame is logged and skipped without breaking later frames", async () => {
    FakeWebSocket.reset()
    const { server, sent } = buildServer()
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: null,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    subscriber.start()
    const ws = FakeWebSocket.instances[0]

    if (!ws) throw new Error("expected a WebSocket")

    ws.emit("message", { data: "not json" })
    ws.emit("message", {
      data: JSON.stringify({ content: "ok", meta: {}, offset: 1 }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(sent).toHaveLength(1)
  })

  test("receiving an event with a higher offset persists it via the port", async () => {
    FakeWebSocket.reset()
    const { server, sent } = buildServer()
    const { port, saves } = buildPort(0)
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: null,
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
      protocols: null,
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
      protocols: null,
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

  test("reconnect after a delivered notification uses the advanced offset", async () => {
    FakeWebSocket.reset()
    const { server } = buildServer()
    const { port } = buildPort(0)
    const subscriber = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: null,
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

    // Wait for the notify await to settle so the offset has advanced.
    await new Promise((resolve) => setTimeout(resolve, 0))

    first.emit("close", { data: "" })

    expect(FakeWebSocket.instances[1]?.url).toBe("ws://gateway/ws?channel=ch1&since=9")
  })

  test("disconnect before notify settles re-uses the prior offset on reconnect so the event re-delivers", async () => {
    FakeWebSocket.reset()
    const { server } = buildServer()
    const { port, saves } = buildPort(3)
    let resolveNotify: (() => void) | null = null
    const notification = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveNotify = resolve
        }),
    )
    const subscriber = new FunnelChannelSubscriber({
      server: { notification } as unknown as Server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: null,
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

    expect(FakeWebSocket.instances[1]?.url).toBe("ws://gateway/ws?channel=ch1&since=3")
    expect(saves).toEqual([])

    // Let the pending notification resolve so the test does not leak a promise.
    resolveNotify?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  test("end-to-end: second subscriber resumes from the disk offset persisted by the first", async () => {
    FakeWebSocket.reset()
    const fs = new MemoryFunnelFileSystem({ dirs: ["/funnel"] })
    const store = new FunnelChannelOffsetStore({ fs, dir: "/funnel", warn: () => undefined })
    const port: ChannelOffsetPort = {
      load: () => store.get("ch1", "/repo"),
      save: (offset) => store.set("ch1", "/repo", offset),
    }
    const { server } = buildServer()

    const first = new FunnelChannelSubscriber({
      server,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: null,
      offsetPort: port,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    first.start()
    const firstWs = FakeWebSocket.instances[0]

    if (!firstWs) throw new Error("expected first WebSocket")

    firstWs.emit("message", {
      data: JSON.stringify({ content: "x", meta: {}, offset: 24 }),
    })
    await new Promise((resolve) => setTimeout(resolve, 0))

    // Simulate MCP child respawn: a brand new subscriber instance.
    const { server: server2 } = buildServer()
    const second = new FunnelChannelSubscriber({
      server: server2,
      baseUrl: "ws://gateway/ws?channel=ch1",
      protocols: null,
      offsetPort: port,
      webSocketFactory: (url, protocols) => new FakeWebSocket(url, protocols) as unknown as WebSocket,
    })

    second.start()

    expect(FakeWebSocket.instances[1]?.url).toBe("ws://gateway/ws?channel=ch1&since=24")
  })
})
