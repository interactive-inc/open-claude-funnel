import { describe, it, expect } from "vitest"
import { FlumeSource } from "@interactive-inc/flume"
import type { FlumeEvent } from "@interactive-inc/flume"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelChannelSupervisor } from "@/engine/channel/channel-supervisor"
import { defineChannel } from "@/engine/channel/channel"

function waitForCondition(fn: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (fn()) {
        resolve()
        return
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("waitForCondition timed out"))
        return
      }
      setTimeout(tick, 5)
    }
    tick()
  })
}

class StubSource extends FlumeSource {
  readonly name = "discord" as const

  pushEvent: ((event: FlumeEvent) => void) | null = null

  protected async connect(): Promise<Error | null> {
    this.setStatus("connected")
    this.pushEvent = (event) => this.emit(event)
    return null
  }

  protected disconnect(): void {
    this.pushEvent = null
  }
}

function freshSupervisor() {
  const broadcaster = new FunnelBroadcaster({ logger: new MemoryFunnelLogger() })
  const supervisor = new FunnelChannelSupervisor({
    broadcaster,
    logger: new MemoryFunnelLogger(),
    clock: new MemoryFunnelClock(),
    fs: new MemoryFunnelFileSystem(),
    dir: "/sandbox/.funnel",
  })
  return { broadcaster, supervisor }
}

describe("FunnelChannelSupervisor", () => {
  it("register + start opens channel sources and forwards transformed events to broadcaster", async () => {
    const { broadcaster, supervisor } = freshSupervisor()
    const received: { content: string; meta?: Record<string, string> }[] = []
    broadcaster.subscribe((event) => received.push({ content: event.content, meta: event.meta }))

    const source = new StubSource()
    supervisor.register(
      defineChannel({
        id: "test-channel",
        build: () => ({
          sources: [source],
          transform: (event) => ({
            content: `tick:${event.type}`,
            meta: { source: "test" },
          }),
        }),
      }),
    )

    await supervisor.start()
    source.pushEvent?.({
      source: "discord",
      type: "hello",
      data: {},
      meta: {},
      receivedAt: 0,
    })

    await waitForCondition(() => received.length === 1)
    expect(received[0]?.content).toBe("tick:hello")
    expect(received[0]?.meta?.source).toBe("test")
  })

  it("transform returning null drops the event", async () => {
    const { broadcaster, supervisor } = freshSupervisor()
    const received: unknown[] = []
    broadcaster.subscribe((event) => received.push(event))

    const source = new StubSource()
    supervisor.register(
      defineChannel({
        id: "dropper",
        build: () => ({ sources: [source], transform: () => null }),
      }),
    )

    await supervisor.start()
    source.pushEvent?.({
      source: "discord",
      type: "ignored",
      data: {},
      meta: {},
      receivedAt: 0,
    })

    await new Promise((r) => setTimeout(r, 30))
    expect(received).toHaveLength(0)
  })

  it("default transform falls back to JSON-stringified event.data + event.meta", async () => {
    const { broadcaster, supervisor } = freshSupervisor()
    const received: { content: string; meta?: Record<string, string> }[] = []
    broadcaster.subscribe((event) => received.push({ content: event.content, meta: event.meta }))

    const source = new StubSource()
    supervisor.register(
      defineChannel({ id: "default", build: () => ({ sources: [source] }) }),
    )

    await supervisor.start()
    source.pushEvent?.({
      source: "discord",
      type: "n/a",
      data: { hello: "world" },
      meta: { trace: "abc" },
      receivedAt: 0,
    })

    await waitForCondition(() => received.length === 1)
    expect(received[0]?.content).toBe(JSON.stringify({ hello: "world" }))
    expect(received[0]?.meta?.trace).toBe("abc")
  })

  it("unregister stops a single channel without affecting others", async () => {
    const { broadcaster, supervisor } = freshSupervisor()
    const received: string[] = []
    broadcaster.subscribe((event) => received.push(event.content))

    const sourceA = new StubSource()
    const sourceB = new StubSource()
    supervisor.register(
      defineChannel({
        id: "a",
        build: () => ({ sources: [sourceA], transform: () => ({ content: "from-a" }) }),
      }),
    )
    supervisor.register(
      defineChannel({
        id: "b",
        build: () => ({ sources: [sourceB], transform: () => ({ content: "from-b" }) }),
      }),
    )

    await supervisor.start()
    await supervisor.unregister("a")

    sourceA.pushEvent?.({ source: "discord", type: "x", data: {}, meta: {}, receivedAt: 0 })
    sourceB.pushEvent?.({ source: "discord", type: "x", data: {}, meta: {}, receivedAt: 0 })

    await waitForCondition(() => received.length === 1)
    expect(received).toEqual(["from-b"])
  })

  it("register after start opens the channel immediately", async () => {
    const { broadcaster, supervisor } = freshSupervisor()
    const received: string[] = []
    broadcaster.subscribe((event) => received.push(event.content))

    await supervisor.start()

    const source = new StubSource()
    supervisor.register(
      defineChannel({
        id: "late",
        build: () => ({ sources: [source], transform: () => ({ content: "late" }) }),
      }),
    )

    await waitForCondition(() => supervisor.has("late"))
    source.pushEvent?.({ source: "discord", type: "x", data: {}, meta: {}, receivedAt: 0 })

    await waitForCondition(() => received.length === 1)
    expect(received).toEqual(["late"])
  })

  it("duplicate register throws", () => {
    const { supervisor } = freshSupervisor()
    const source = new StubSource()
    supervisor.register(defineChannel({ id: "dup", build: () => ({ sources: [source] }) }))
    expect(() =>
      supervisor.register(defineChannel({ id: "dup", build: () => ({ sources: [source] }) })),
    ).toThrow(/already registered/)
  })

  it("stop closes every channel", async () => {
    const { supervisor } = freshSupervisor()
    const source = new StubSource()
    supervisor.register(defineChannel({ id: "x", build: () => ({ sources: [source] }) }))
    await supervisor.start()
    await supervisor.stop()
    expect(supervisor.ids()).toEqual([])
  })
})
