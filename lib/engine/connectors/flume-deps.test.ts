import { describe, expect, test } from "bun:test"
import { flumeLogHandler } from "@/engine/connectors/flume-deps"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"

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
