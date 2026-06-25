import { describe, expect, test } from "bun:test"
import { FunnelFlumeSourceListener } from "@/engine/connectors/flume-source-listener"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import type { FlumeHandler, FlumeSource, FlumeStatus } from "@interactive-inc/flume"

type SourceHooks = {
  startError?: Error
  stopError?: Error
}

const buildSource = (hooks: SourceHooks = {}): FlumeSource => {
  let stopped = false
  return {
    name: "slack",
    start: async () => hooks.startError ?? null,
    stop: async () => {
      if (stopped) return
      stopped = true
      if (hooks.stopError) throw hooks.stopError
    },
    status: () => "connected",
  }
}

class TestListener extends FunnelFlumeSourceListener {
  resetCount = 0

  constructor(diagnosticLog: MemoryConnectorDiagnosticLog) {
    super({
      type: "slack",
      connectorId: "co-1",
      channelId: "ch-1",
      diagnosticLog,
    })
  }

  async start(): Promise<void> {
    // Real subclasses build their source here; this stub exists only because
    // the abstract FunnelConnectorListener.start signature is inherited. Tests
    // drive the flow via runFromTest below.
  }

  async runFromTest(source: FlumeSource, handler: FlumeHandler): Promise<void> {
    await this.runStart(source, handler)
  }

  emitStatus(status: FlumeStatus, detail?: string): void {
    this.handleStatus(status, detail)
  }

  protected override onStop(): void {
    this.resetCount += 1
  }
}

describe("FunnelFlumeSourceListener", () => {
  test("records connected/disconnected on status transitions and flips alive accordingly", async () => {
    const log = new MemoryConnectorDiagnosticLog()
    const listener = new TestListener(log)
    const source = buildSource()

    await listener.runFromTest(source, (() => {}) as FlumeHandler)
    listener.emitStatus("connected", "ws open")
    expect(listener.isAlive()).toBe(true)

    listener.emitStatus("reconnecting", "")
    expect(listener.isAlive()).toBe(false)

    listener.emitStatus("connected")
    expect(listener.isAlive()).toBe(true)

    listener.emitStatus("disconnected", "remote close")
    expect(listener.isAlive()).toBe(false)

    const statuses = log
      .queryConnection({ type: "slack" })
      .map((row) => row.status)

    expect(statuses).toEqual(["connected", "connected", "disconnected"])
  })

  test("stop records disconnected then stopped, calls onStop, and survives a stop error", async () => {
    const log = new MemoryConnectorDiagnosticLog()
    const listener = new TestListener(log)
    const source = buildSource({ stopError: new Error("close kaput") })

    await listener.runFromTest(source, (() => {}) as FlumeHandler)
    listener.emitStatus("connected")
    await listener.stop()

    expect(listener.isAlive()).toBe(false)
    expect(listener.resetCount).toBe(1)

    const rows = log.queryConnection({ type: "slack" }).map((r) => ({
      status: r.status,
      detail: r.detail,
    }))

    expect(rows).toContainEqual({ status: "connected", detail: "" })
    expect(rows).toContainEqual({ status: "error", detail: "close kaput" })
    expect(rows[rows.length - 1]).toEqual({ status: "stopped", detail: "" })
  })

  test("runStart records error on flume returning a start error and rethrows", async () => {
    const log = new MemoryConnectorDiagnosticLog()
    const listener = new TestListener(log)
    const source = buildSource({ startError: new Error("socket refused") })

    await expect(listener.runFromTest(source, (() => {}) as FlumeHandler)).rejects.toThrow(
      "socket refused",
    )

    expect(listener.isAlive()).toBe(false)

    const errorRows = log
      .queryConnection({ type: "slack", status: "error" })
      .map((r) => r.detail)

    expect(errorRows).toContain("socket refused")
  })

  test("reconnecting status does not write a row but still flips alive off", async () => {
    const log = new MemoryConnectorDiagnosticLog()
    const listener = new TestListener(log)
    const source = buildSource()

    await listener.runFromTest(source, (() => {}) as FlumeHandler)
    listener.emitStatus("connected")
    listener.emitStatus("reconnecting", "network blip")

    expect(listener.isAlive()).toBe(false)

    const statuses = log
      .queryConnection({ type: "slack" })
      .map((row) => row.status)

    // No "reconnecting" row — only the prior connected.
    expect(statuses).toEqual(["connected"])
  })
})

