import { describe, expect, test } from "bun:test"
import type { ServerWebSocket } from "bun"
import { Funnel } from "@/funnel"

const setup = (delivery: "fanout" | "exclusive" = "fanout") => {
  const funnel = new Funnel({ channels: [{ name: "ops", delivery }, { name: "other" }] })
  return { funnel, gateway: funnel.gatewayModule({ token: "" }) }
}

describe("embedded event subscriptions", () => {
  test("subscribes eagerly, filters by stable channel id and queues startup input in order", async () => {
    const { funnel, gateway } = setup()
    const events = gateway.events({ channel: funnel.channels.get("ops")!.id })
    try {
      gateway.emit({ channel: "other", content: "ignore" })
      gateway.emit({ channel: "ops", content: "first" })
      await gateway.start()
      gateway.emit({ channel: "ops", content: "second" })
      expect((await events.next()).value.content).toBe("first")
      expect((await events.next()).value.content).toBe("second")
    } finally {
      await gateway.stop()
    }
  })

  test("native subscriptions obey fanout and addressed delivery", async () => {
    const { gateway } = setup()
    const first = gateway.events({ channel: "ops", subscriberId: "first" })
    const second = gateway.events({ channel: "ops", subscriberId: "second" })
    try {
      gateway.emit({ channel: "ops", content: "all" })
      expect((await first.next()).value.content).toBe("all")
      expect((await second.next()).value.content).toBe("all")
      gateway.emit({ channel: "ops", content: "private", meta: { target: "second" } })
      gateway.emit({ channel: "ops", content: "after" })
      expect((await first.next()).value.content).toBe("after")
      expect((await second.next()).value.content).toBe("private")
    } finally {
      await gateway.stop()
    }
  })

  test("exclusive assignment is shared between native and WebSocket recipients", async () => {
    const { funnel, gateway } = setup("exclusive")
    const received: string[] = []
    const socket = {
      send(payload: string) {
        received.push(JSON.parse(payload).content)
      },
      getBufferedAmount: () => 0,
    } as unknown as ServerWebSocket<unknown>
    gateway.getBroadcaster().addClient(socket, {
      channel: funnel.channels.get("ops")!.id,
      connectors: [],
      delivery: "exclusive",
      subscriberId: "socket",
    })
    const events = gateway.events({ channel: "ops", subscriberId: "sdk" })
    try {
      gateway.emit({ channel: "ops", content: "one" })
      gateway.emit({ channel: "ops", content: "two" })
      gateway.emit({ channel: "ops", content: "three" })
      expect(received).toEqual(["one", "three"])
      expect((await events.next()).value.content).toBe("two")
      expect(
        gateway
          .getEventLog()
          .loadSince(0)
          .map((event) => Object.values(event.exclusive!)[0]),
      ).toEqual(["socket", "sdk", "socket"])
    } finally {
      await gateway.stop()
    }
  })

  test("replays retained events before live input without repeating the cursor event", async () => {
    const { gateway } = setup()
    try {
      gateway.emit({ channel: "ops", content: "before" })
      gateway.emit({ channel: "other", content: "ignore" })
      gateway.emit({ channel: "ops", content: "replay" })
      const events = gateway.events({ channel: "ops", since: 1 })
      gateway.emit({ channel: "ops", content: "live" })
      expect((await events.next()).value).toMatchObject({ content: "replay", offset: 3 })
      expect((await events.next()).value).toMatchObject({ content: "live", offset: 4 })
    } finally {
      await gateway.stop()
    }
  })

  test("exclusive replay is claimed once and stays with the same worker", async () => {
    const { gateway } = setup("exclusive")
    try {
      gateway.emit({ channel: "ops", content: "offline" })
      const first = gateway.events({ channel: "ops", subscriberId: "first", since: 0 })
      expect((await first.next()).value.content).toBe("offline")
      await first.return()
      const other = gateway.events({ channel: "ops", subscriberId: "other", since: 0 })
      const reconnect = gateway.events({ channel: "ops", subscriberId: "first", since: 0 })
      expect((await reconnect.next()).value.content).toBe("offline")
      gateway.emit({ channel: "ops", content: "addressed", meta: { target: "other" } })
      expect((await other.next()).value.content).toBe("addressed")
    } finally {
      await gateway.stop()
    }
  })

  test("return, abort and shutdown finish pending reads and release subscriptions", async () => {
    const { gateway } = setup()
    const byReturn = gateway.events({ channel: "ops" })
    const firstRead = byReturn.next()
    await byReturn.return()
    expect(await firstRead).toEqual({ done: true, value: undefined })
    const controller = new AbortController()
    const byAbort = gateway.events({ channel: "ops", signal: controller.signal })
    const secondRead = byAbort.next()
    controller.abort()
    expect((await secondRead).done).toBe(true)
    const byStop = gateway.events({ channel: "ops" })
    const thirdRead = byStop.next()
    await gateway.stop()
    expect((await thirdRead).done).toBe(true)
    expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    expect(() => gateway.events({ channel: "ops" })).toThrow("stopped")
  })

  test("cancelled subscriptions do not attach, and break discards queued input", async () => {
    const { gateway } = setup()
    try {
      const cancelled = gateway.events({ channel: "ops", signal: AbortSignal.abort() })
      expect((await cancelled.next()).done).toBe(true)
      const events = gateway.events({ channel: "ops" })
      gateway.emit({ channel: "ops", content: "one" })
      gateway.emit({ channel: "ops", content: "two" })
      for await (const event of events) {
        expect(event.content).toBe("one")
        break
      }
      expect((await events.next()).done).toBe(true)
      expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    } finally {
      await gateway.stop()
    }
  })

  test("shutdown discards queued prompts", async () => {
    const { gateway } = setup()
    const events = gateway.events({ channel: "ops" })
    gateway.emit({ channel: "ops", content: "do not run after stop" })
    await gateway.stop()
    expect((await events.next()).done).toBe(true)
  })

  test("overflow is explicit, isolates slow consumers and allows retained replay", async () => {
    const { gateway } = setup()
    try {
      const slow = gateway.events({ channel: "ops", maxQueuedEvents: 1 })
      const fast = gateway.events({ channel: "ops" })
      gateway.emit({ channel: "ops", content: "one" })
      expect((await fast.next()).value.content).toBe("one")
      gateway.emit({ channel: "ops", content: "two" })
      expect((await fast.next()).value.content).toBe("two")
      await expect(slow.next()).rejects.toThrow("overflow")
      expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(1)
      const recovered = gateway.events({ channel: "ops", since: 0 })
      expect((await recovered.next()).value.content).toBe("one")
      expect((await recovered.next()).value.content).toBe("two")
    } finally {
      await gateway.stop()
    }
  })

  test("byte bounds include UTF-8 metadata and count when no consumer is reading", async () => {
    const { gateway } = setup()
    try {
      const events = gateway.events({ channel: "ops", maxQueuedBytes: 20 })
      gateway.emit({ channel: "ops", content: "日本語", meta: { detail: "large" } })
      await expect(events.next()).rejects.toThrow("overflow")
    } finally {
      await gateway.stop()
    }
  })

  test("failed persistence never reaches native consumers", async () => {
    const { gateway } = setup()
    const events = gateway.events({ channel: "ops" })
    gateway.getEventLog().record = () => {
      throw new Error("disk full")
    }
    expect(() => gateway.emit({ channel: "ops", content: "lost" })).toThrow("disk full")
    const next = events.next()
    await events.return()
    expect((await next).done).toBe(true)
    await gateway.stop()
  })

  test("invalid subscriptions fail before attaching", async () => {
    const { gateway } = setup("exclusive")
    try {
      expect(() => gateway.events({ channel: "missing" })).toThrow()
      expect(() => gateway.events({ channel: "ops" })).toThrow("subscriber id")
      for (const since of [-1, NaN, Infinity, 1.5])
        expect(() => gateway.events({ channel: "ops", subscriberId: "sdk", since })).toThrow(
          "since",
        )
      expect(() =>
        gateway.events({ channel: "ops", subscriberId: "sdk", maxQueuedEvents: 0 }),
      ).toThrow("maxQueuedEvents")
      expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    } finally {
      await gateway.stop()
    }
  })
})
