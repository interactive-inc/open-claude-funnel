import { describe, it, expect } from "vitest"
import { FlumeSource } from "@interactive-inc/flume"
import type { FlumeEvent } from "@interactive-inc/flume"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { FunnelChannelSupervisor } from "@/engine/channel/channel-supervisor"
import { defineChannel, type ChannelTransform } from "@/engine/channel/channel"

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

    signal: options.signal,
  })
  return { received, logger, supervisor }
}

describe("FunnelChannelSupervisor", () => {
  for (const kind of ["promise", "hidden-then", "thenable"] as const) {
    it(`rejects a ${kind} transform result before delivery and observes its late failure`, async () => {
      const { supervisor, received, logger } = freshSupervisor()
      const source = new StubSource()
      let calls = 0
      const transform = (() => {
        if (++calls > 1) return { content: "good" }
        const failure = new Error("late transform failure")
        if (kind !== "thenable") {
          const result = Promise.reject(failure)
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied promise with a hidden then method.
          if (kind === "hidden-then") Object.defineProperty(result, "then", { value: undefined })
          return result
        }
        return {
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
          then(_resolve: unknown, reject: (error: unknown) => void) {
            reject(failure)
          },
        }
      }) as unknown as ChannelTransform
      supervisor.register({ id: "source", build: () => ({ sources: [source], transform }) })
      try {
        await supervisor.start()
        for (let index = 0; index < 2; index++)
          source.pushEvent?.({
            source: "discord",
            type: "input",
            data: {},
            meta: {},
            receivedAt: 0,
          })
        await waitForCondition(() => received.length === 1)
        await Bun.sleep(0)
        expect(received.map((item) => item.content)).toEqual(["good"])
        expect(calls).toBe(2)
        expect(logger.entries.filter((entry) => entry.level === "error")).toMatchObject([
          {
            message: 'channel "source" transform threw',
            meta: { error: "channel transform must be synchronous" },
          },
          {
            message: 'channel "source" transform threw',
            meta: { error: "late transform failure" },
          },
        ])
      } finally {
        await supervisor.stop()
      }
    })
  }

  it("reads a runtime transform once per event and preserves its class receiver and error context", async () => {
    const { supervisor, received, logger } = freshSupervisor()
    const source = new StubSource()
    class Runtime {
      readonly sources = [source]
      reads = 0
      #calls = 0
      get transform() {
        if (++this.reads > 2) return undefined
        return function (this: Runtime) {
          if (++this.#calls === 1) throw Object.create(null)
          return { content: "converted" }
        }
      }
      get calls() {
        return this.#calls
      }
    }
    const runtime = new Runtime()
    supervisor.register({ id: "source", build: () => runtime })
    try {
      await supervisor.start()
      for (let index = 0; index < 3; index++)
        source.pushEvent?.({
          source: "discord",
          type: "input",
          data: { raw: true },
          meta: {},
          receivedAt: 0,
        })
      await waitForCondition(() => received.length === 2)
      expect(received.map((item) => item.content)).toEqual(["converted", '{"raw":true}'])
      expect(runtime.reads).toBe(3)
      expect(runtime.calls).toBe(2)
      expect(logger.entries.filter((entry) => entry.level === "error")).toMatchObject([
        {
          message: 'channel "source" transform threw',
          meta: { error: "Unprintable thrown value" },
        },
      ])
    } finally {
      await supervisor.stop()
    }
  })

  it("continues delivery after a sink throws an unprintable value", async () => {
    const source = new StubSource()
    const logger = new MemoryFunnelLogger()
    const delivered = Promise.withResolvers<void>()
    let calls = 0
    const supervisor = new FunnelChannelSupervisor({
      broadcaster: {
        broadcast() {
          if (++calls === 1) throw Object.create(null)
          delivered.resolve()
        },
      },
      logger,
      clock: new MemoryFunnelClock(),
    })
    supervisor.register({ id: "source", build: () => ({ sources: [source] }) })
    const timer = setTimeout(() => delivered.reject(new Error("delivery timed out")), 1000)
    try {
      await supervisor.start()
      for (let index = 0; index < 2; index++)
        source.pushEvent?.({ source: "discord", type: "x", data: {}, meta: {}, receivedAt: 0 })
      await delivered.promise
      expect(calls).toBe(2)
      expect(logger.entries.some((entry) => entry.meta?.error === "Unprintable thrown value")).toBe(
        true,
      )
    } finally {
      clearTimeout(timer)
      await supervisor.stop()
    }
  })

  it("stop aborts a manifest build already in progress and never opens its late sources", async () => {
    const { supervisor } = freshSupervisor()
    const source = new StubSource()
    const building = Promise.withResolvers<AbortSignal>()
    supervisor.register(
      defineChannel({
        id: "pending",
        build: async (ctx) => {
          building.resolve(ctx.signal)
          await new Promise<void>((resolve) =>
            ctx.signal.addEventListener("abort", () => resolve(), { once: true }),
          )
          return { sources: [source] }
        },
      }),
    )
    const starting = supervisor.start()
    const signal = await building.promise
    await supervisor.stop()
    await starting
    expect(signal.aborted).toBe(true)
    expect(source.pushEvent).toBeNull()
    expect(supervisor.ids()).toEqual([])
    expect(supervisor.has("pending")).toBe(false)
  })

  it("multiple sources use the same transform and stop together", async () => {
    const { supervisor, received } = freshSupervisor()
    const first = new StubSource()
    const second = new StubSource()
    supervisor.register(defineChannel({ id: "many", build: () => ({ sources: [first, second] }) }))
    await supervisor.start()
    for (const source of [first, second])
      source.pushEvent?.({ source: "discord", type: "x", data: {}, meta: {}, receivedAt: 0 })
    await waitForCondition(() => received.length === 2)
    await supervisor.stop()
    expect(first.pushEvent).toBeNull()
    expect(second.pushEvent).toBeNull()
  })

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
    supervisor.register(defineChannel({ id: "default", build: () => ({ sources: [source] }) }))

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

describe("channel transform payload validation", () => {
  for (const [kind, value] of [
    ["undefined", undefined],
    ["array", []],
    ["missing content", {}],
    ["numeric content", { content: 42 }],
    ["null metadata", { content: "bad", meta: null }],
    ["array metadata", { content: "bad", meta: [] }],
    ["map metadata", { content: "bad", meta: new Map([["key", "value"]]) }],
    ["numeric metadata", { content: "bad", meta: { key: 42 } }],
    ["invalid special key", { content: "bad", meta: Object.fromEntries([["__proto__", 42]]) }],
  ]) {
    it(`rejects ${kind} and continues with later valid input`, async () => {
      const { supervisor, received, logger } = freshSupervisor()
      const source = new StubSource()
      let calls = 0
      supervisor.register({
        id: "source",
        build: () => ({
          sources: [source],
          transform: (() => (++calls === 1 ? value : { content: "recovered" })) as ChannelTransform,
        }),
      })
      try {
        await supervisor.start()
        for (let index = 0; index < 2; index++)
          source.pushEvent?.({
            source: "discord",
            type: "input",
            data: {},
            meta: {},
            receivedAt: 0,
          })
        await waitForCondition(() => received.some((event) => event.content === "recovered"))
        expect(received).toEqual([{ content: "recovered", meta: undefined }])
        expect(logger.entries.filter((entry) => entry.level === "error")).toMatchObject([
          { message: 'channel "source" transform threw' },
        ])
      } finally {
        await supervisor.stop()
      }
    })
  }
  for (const [kind, data] of [
    ["undefined", undefined],
    ["function", () => {}],
    ["symbol", Symbol("input")],
    ["toJSON", { toJSON: () => undefined }],
  ] as const) {
    it(`does not deliver a missing default JSON body from ${kind}`, async () => {
      const { supervisor, received, logger } = freshSupervisor()
      const source = new StubSource()
      supervisor.register({ id: "source", build: () => ({ sources: [source] }) })
      try {
        await supervisor.start()
        for (const input of [data, { recovered: true }])
          source.pushEvent?.({
            source: "discord",
            type: "input",
            data: input as never,
            meta: {},
            receivedAt: 0,
          })
        await waitForCondition(() =>
          received.some((event) => event.content === '{"recovered":true}'),
        )
        expect(received.map((event) => event.content)).toEqual(['{"recovered":true}'])
        expect(logger.entries.filter((entry) => entry.level === "error")).toMatchObject([
          { message: 'channel "source" transform threw' },
        ])
      } finally {
        await supervisor.stop()
      }
    })
  }
  for (const field of ["content", "meta", "meta-value"] as const) {
    for (const kind of ["resolved", "rejected", "hidden-then", "thenable"] as const) {
      it(`rejects ${kind} asynchronous ${field} values and observes their failure`, async () => {
        const { supervisor, received, logger } = freshSupervisor()
        const source = new StubSource()
        let calls = 0
        const failure = new Error("payload field unavailable")
        const bad = () => {
          if (kind === "thenable")
            return {
              // oxlint-disable-next-line unicorn/no-thenable -- Exercise an asynchronous transform payload field.
              then(_resolve: unknown, reject: (error: unknown) => void) {
                reject(failure)
              },
            }
          const value = kind === "resolved" ? Promise.resolve("later") : Promise.reject(failure)
          void value.catch(() => {})
          if (kind === "hidden-then") {
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise with a hidden method.
            Object.defineProperty(value, "then", { value: undefined })
          }
          return value
        }
        supervisor.register({
          id: "source",
          build: () => ({
            sources: [source],
            transform: (() => {
              if (++calls > 1) return { content: "recovered" }
              const value = bad()
              return {
                content: field === "content" ? value : "bad",
                meta:
                  field === "meta" ? value : field === "meta-value" ? { key: value } : undefined,
              }
            }) as ChannelTransform,
          }),
        })
        try {
          await supervisor.start()
          for (let index = 0; index < 2; index++)
            source.pushEvent?.({
              source: "discord",
              type: "input",
              data: {},
              meta: {},
              receivedAt: 0,
            })
          await waitForCondition(() => received.some((event) => event.content === "recovered"))
          await Bun.sleep(0)
          expect(received).toEqual([{ content: "recovered", meta: undefined }])
          const errors = logger.entries.filter((entry) => entry.level === "error")
          expect(errors).toHaveLength(kind === "resolved" ? 1 : 2)
          expect(
            errors.every((entry) => entry.message === 'channel "source" transform threw'),
          ).toBe(true)
          if (kind !== "resolved")
            expect(errors.some((entry) => entry.meta?.error === failure.message)).toBe(true)
        } finally {
          await supervisor.stop()
        }
      })
    }
  }
  it("captures content and metadata once, preserves special keys and detaches metadata", async () => {
    const { supervisor, received } = freshSupervisor()
    const source = new StubSource()
    const meta = Object.fromEntries([
      ["__proto__", "retained"],
      ["constructor", "retained"],
      ["key", "original"],
    ])
    let contentReads = 0
    let metaReads = 0
    supervisor.register({
      id: "source",
      build: () => ({
        sources: [source],
        transform: () => ({
          get content() {
            contentReads++
            return "captured"
          },
          get meta() {
            metaReads++
            return meta
          },
        }),
      }),
    })
    try {
      await supervisor.start()
      source.pushEvent?.({ source: "discord", type: "input", data: {}, meta: {}, receivedAt: 0 })
      await waitForCondition(() => received.length === 1)
      meta.key = "changed"
      expect(received[0]).toEqual({
        content: "captured",
        meta: Object.fromEntries([
          ["__proto__", "retained"],
          ["constructor", "retained"],
          ["key", "original"],
        ]),
      })
      expect(contentReads).toBe(1)
      expect(metaReads).toBe(1)
    } finally {
      await supervisor.stop()
    }
  })
  it("keeps an empty custom body and valid falsey default JSON values", async () => {
    const { supervisor, received } = freshSupervisor()
    const source = new StubSource()
    const empty = new StubSource()
    supervisor.register({
      id: "empty",
      build: () => ({
        sources: [empty],
        transform: () => ({ content: "" }),
      }),
    })
    supervisor.register({ id: "default", build: () => ({ sources: [source] }) })
    try {
      await supervisor.start()
      empty.pushEvent?.({ source: "discord", type: "empty", data: {}, meta: {}, receivedAt: 0 })
      await waitForCondition(() => received.length === 1)
      for (const data of [null, false, 0, ""])
        source.pushEvent?.({
          source: "discord",
          type: "input",
          data: { toJSON: () => data },
          meta: {},
          receivedAt: 0,
        })
      await waitForCondition(() => received.length === 5)
      expect(received.map((event) => event.content)).toEqual(["", "null", "false", "0", '""'])
    } finally {
      await supervisor.stop()
    }
  })
})

it("does not inspect a transform payload after the transform stops the supervisor", async () => {
  const { supervisor, received, logger } = freshSupervisor()
  const source = new StubSource()
  let stopping: Promise<void> | undefined
  let reads = 0
  supervisor.register({
    id: "source",
    build: () => ({
      sources: [source],
      transform: () => {
        stopping = supervisor.stop()
        return {
          get content(): string {
            reads++
            throw new Error("payload inspected after stop")
          },
        }
      },
    }),
  })
  try {
    await supervisor.start()
    source.pushEvent?.({ source: "discord", type: "input", data: {}, meta: {}, receivedAt: 0 })
    await waitForCondition(() => stopping !== undefined)
    await stopping
    expect(reads).toBe(0)
    expect(received).toEqual([])
    expect(logger.entries.filter((entry) => entry.level === "error")).toEqual([])
  } finally {
    await supervisor.stop()
  }
})
