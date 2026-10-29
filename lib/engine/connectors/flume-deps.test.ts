import { describe, expect, test } from "bun:test"
import { flumeLogHandler, resolveFlumeDeps } from "@/engine/connectors/flume-deps"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"

describe("resolveFlumeDeps", () => {
  test("leaves absent overrides to Flume", () => {
    expect(resolveFlumeDeps(undefined)).toBeUndefined()
    expect(resolveFlumeDeps({})).toBeUndefined()
  })

  test("retains prototype methods and their original receiver", async () => {
    class Runtime {
      #calls = 0

      async fetch(): Promise<Response> {
        this.#calls++
        return new Response(String(this.#calls))
      }

      now(): number {
        return this.#calls
      }
    }
    const deps = resolveFlumeDeps(new Runtime())
    expect(deps).toBeDefined()
    if (!deps) return
    expect(await (await deps.fetch("https://example.com")).text()).toBe("1")
    expect(deps.now()).toBe(1)
  })

  test("retains non-enumerable overrides", () => {
    const runtime = Object.defineProperty({}, "now", { value: () => 42 })
    expect(resolveFlumeDeps(runtime)?.now()).toBe(42)
  })

  test("preserves the default WebSocket's lazy lookup", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "WebSocket")
    try {
      const deps = resolveFlumeDeps({ now: () => 42 })
      Object.defineProperty(globalThis, "WebSocket", { configurable: true, value: undefined })
      expect(deps?.WebSocket).toBeNull()
      Object.defineProperty(globalThis, "WebSocket", {
        configurable: true,
        value: WebSocketFixture,
      })
      expect(deps?.WebSocket).toBe(WebSocketFixture)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "WebSocket", descriptor)
      else Reflect.deleteProperty(globalThis, "WebSocket")
    }
  })

  test("retains an explicitly disabled WebSocket", () => {
    expect(resolveFlumeDeps({ WebSocket: null })?.WebSocket).toBeNull()
  })

  test("captures host getters once", () => {
    let reads = 0
    const deps = resolveFlumeDeps({
      get now() {
        reads++
        return () => reads
      },
    })
    expect(deps?.now()).toBe(1)
    expect(deps?.now()).toBe(1)
    expect(reads).toBe(1)
  })

  test("rejects an explicitly invalid callback without restoring default IO", () => {
    for (const key of [
      "fetch",
      "now",
      "random",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ]) {
      expect(() => resolveFlumeDeps({ [key]: undefined })).toThrow(
        `Invalid runtime dependency: ${key}`,
      )
    }
  })
})

class WebSocketFixture extends WebSocket {}

describe("flumeLogHandler", () => {
  test("returns undefined when no logger is given", () => {
    expect(flumeLogHandler(undefined)).toBeUndefined()
  })

  test("forwards info logs with structured detail merged into meta", () => {
    const logger = new MemoryFunnelLogger()
    const handler = flumeLogHandler(logger)

    handler!({
      level: "info",
      source: "slack",
      action: "connect",
      message: "socket open",
      detail: { reconnect: 2, port: 443 },
      timestamp: 0,
    })

    expect(logger.entries).toEqual([
      {
        level: "info",
        message: "slack/connect: socket open",
        meta: { reconnect: 2, port: 443 },
      },
    ])
  })

  test("forwards error logs with stack and message preserved", () => {
    const logger = new MemoryFunnelLogger()
    const handler = flumeLogHandler(logger)

    const upstream = new Error("auth.test failed")
    upstream.name = "FlumeHttpError"
    upstream.stack = "stack-line-1\nstack-line-2"

    handler!({
      level: "error",
      source: "slack",
      action: "auth",
      message: "auth failed",
      error: upstream,
      timestamp: 0,
    })

    expect(logger.entries).toEqual([
      {
        level: "error",
        message: "slack/auth: auth failed",
        meta: {
          error: "auth.test failed",
          stack: "stack-line-1\nstack-line-2",
          errorName: "FlumeHttpError",
        },
      },
    ])
  })

  test("forwards error logs with both detail and error data merged", () => {
    const logger = new MemoryFunnelLogger()
    const handler = flumeLogHandler(logger)

    handler!({
      level: "error",
      source: "github",
      action: "poll",
      message: "http 401",
      detail: { url: "/notifications", attempt: 3 },
      error: new Error("Unauthorized"),
      timestamp: 0,
    })

    const entry = logger.entries[0]!
    expect(entry.meta?.url).toBe("/notifications")
    expect(entry.meta?.attempt).toBe(3)
    expect(entry.meta?.error).toBe("Unauthorized")
  })

  test("drops debug logs to avoid drowning info with heartbeats", () => {
    const logger = new MemoryFunnelLogger()
    const handler = flumeLogHandler(logger)

    handler!({
      level: "debug",
      source: "discord",
      action: "heartbeat",
      message: "ack",
      timestamp: 0,
    })

    expect(logger.entries).toEqual([])
  })

  test("omits meta entirely when nothing structured is present", () => {
    const logger = new MemoryFunnelLogger()
    const handler = flumeLogHandler(logger)

    handler!({
      level: "warn",
      source: "slack",
      action: "reconnect",
      message: "retrying",
      timestamp: 0,
    })

    expect(logger.entries).toEqual([
      {
        level: "warn",
        message: "slack/reconnect: retrying",
        meta: undefined,
      },
    ])
  })
})
