import { describe, it, expect } from "vitest"
import { FlumeSource } from "@interactive-inc/flume"
import type { FlumeEvent } from "@interactive-inc/flume"
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

function freshSupervisor(options: { signal?: AbortSignal } = {}) {
  const received: { content: string; meta?: Record<string, string> }[] = []
  const logger = new MemoryFunnelLogger()
  const supervisor = new FunnelChannelSupervisor({
    broadcaster: {
      broadcast: (content, meta) => {
        received.push({ content, meta })
      },
    },
    logger,
    clock: new MemoryFunnelClock(),
    fs: new MemoryFunnelFileSystem(),
    dir: "/sandbox/.funnel",
    signal: options.signal,
  })
  return { received, logger, supervisor }
}

describe("FunnelChannelSupervisor", () => {
  it("register + start opens channel sources and forwards transformed events to broadcaster", async () => {
    const { received, supervisor } = freshSupervisor()

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
    const { received, supervisor } = freshSupervisor()

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
    const { received, supervisor } = freshSupervisor()

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

  it("a throwing transform is logged and only drops that event", async () => {
    const { received, logger, supervisor } = freshSupervisor()

    const source = new StubSource()
    supervisor.register(
      defineChannel({
        id: "thrower",
        build: () => ({
          sources: [source],
          transform: (event) => {
            if (event.type === "bad") throw new Error("transform boom")
            return { content: "good" }
          },
        }),
      }),
    )

    await supervisor.start()
    source.pushEvent?.({ source: "discord", type: "bad", data: {}, meta: {}, receivedAt: 0 })
    source.pushEvent?.({ source: "discord", type: "ok", data: {}, meta: {}, receivedAt: 0 })

    await waitForCondition(() => received.length === 1)
    expect(received).toEqual([{ content: "good", meta: undefined }])
    expect(
      logger.entries.some((entry) => entry.level === "error" && entry.message.includes("thrower")),
    ).toBe(true)
  })

  it("unregister stops a single channel without affecting others", async () => {
    const { received, supervisor } = freshSupervisor()

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
    expect(received.map((entry) => entry.content)).toEqual(["from-b"])
  })

  it("register after start opens the channel immediately", async () => {
    const { received, supervisor } = freshSupervisor()

    await supervisor.start()

    const source = new StubSource()
    supervisor.register(
      defineChannel({
        id: "late",
        build: () => ({ sources: [source], transform: () => ({ content: "late" }) }),
      }),
    )

    await waitForCondition(() => supervisor.ids().includes("late"))
    source.pushEvent?.({ source: "discord", type: "x", data: {}, meta: {}, receivedAt: 0 })

    await waitForCondition(() => received.length === 1)
    expect(received.map((entry) => entry.content)).toEqual(["late"])
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

  it("register and start are inert when the host signal is already aborted", async () => {
    const abortController = new AbortController()
    abortController.abort()
    const { supervisor } = freshSupervisor({ signal: abortController.signal })

    const source = new StubSource()
    supervisor.register(defineChannel({ id: "dead", build: () => ({ sources: [source] }) }))

    await supervisor.start()

    expect(supervisor.has("dead")).toBe(false)
    expect(supervisor.ids()).toEqual([])
    expect(source.pushEvent).toBeNull()
  })

  it("a channel whose build throws is logged and does not block other channels", async () => {
    const { received, logger, supervisor } = freshSupervisor()

    const source = new StubSource()
    supervisor.register(
      defineChannel({
        id: "broken",
        build: () => {
          throw new Error("build boom")
        },
      }),
    )
    supervisor.register(
      defineChannel({
        id: "healthy",
        build: () => ({ sources: [source], transform: () => ({ content: "ok" }) }),
      }),
    )

    await supervisor.start()

    expect(supervisor.has("broken")).toBe(false)
    expect(supervisor.has("healthy")).toBe(true)
    expect(
      logger.entries.some((entry) => entry.level === "error" && entry.message.includes("broken")),
    ).toBe(true)

    source.pushEvent?.({ source: "discord", type: "x", data: {}, meta: {}, receivedAt: 0 })
    await waitForCondition(() => received.length === 1)
    expect(received[0]?.content).toBe("ok")
  })

  it("build throwing after start is logged and leaves the channel unregistered", async () => {
    const { logger, supervisor } = freshSupervisor()
    await supervisor.start()

    supervisor.register(
      defineChannel({
        id: "late-broken",
        build: async () => {
          throw new Error("late boom")
        },
      }),
    )

    await waitForCondition(() =>
      logger.entries.some(
        (entry) => entry.level === "error" && entry.message.includes("late-broken"),
      ),
    )
    expect(supervisor.has("late-broken")).toBe(false)
  })

  it("unregister awaits an in-flight post-start open", async () => {
    const { received, supervisor } = freshSupervisor()
    await supervisor.start()

    const source = new StubSource()
    supervisor.register(
      defineChannel({
        id: "racy",
        build: async () => {
          await new Promise((r) => setTimeout(r, 20))
          return { sources: [source], transform: () => ({ content: "racy" }) }
        },
      }),
    )

    await supervisor.unregister("racy")

    expect(supervisor.has("racy")).toBe(false)
    source.pushEvent?.({ source: "discord", type: "x", data: {}, meta: {}, receivedAt: 0 })
    await new Promise((r) => setTimeout(r, 30))
    expect(received).toHaveLength(0)
  })
})
