import { describe, expect, test } from "bun:test"
import { FunnelFlumeSourceListener } from "@/engine/connectors/flume-source-listener"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import {
  FlumeSource,
  type FlumeEventHandler,
  type FlumeSourceStartContext,
  type FlumeStatus,
} from "@interactive-inc/flume"

// Flume 0.9 dropped FlumeStatusEvent; funnel reconstructs the same shape
// internally from `log.action === "status"` log entries. The tests still want
// to call `handleStatus()` directly to drive deterministic transitions.
type StatusEvent = { source: string; status: FlumeStatus; detail: string | null }

type FakeHooks = {
  /** Error to return from `connect()` so Flume rolls back the start and we hit the FlumeStartError path. */
  connectError?: Error
  /** Throw from `disconnect()` so we exercise the stop-error branch in the base class. */
  disconnectError?: Error
}

class FakeFlumeSource extends FlumeSource {
  readonly name = "slack"
  capturedCtx: FlumeSourceStartContext | null = null
  disconnectCalls = 0

  constructor(private readonly hooks: FakeHooks = {}) {
    super()
  }

  protected override async connect(ctx: FlumeSourceStartContext): Promise<Error | null> {
    if (this.hooks.connectError) return this.hooks.connectError
    this.capturedCtx = ctx
    return null
  }

  protected override async disconnect(): Promise<void> {
    this.disconnectCalls += 1
    if (this.hooks.disconnectError) throw this.hooks.disconnectError
    this.capturedCtx = null
  }
}

class TestListenerWithSignal extends FunnelFlumeSourceListener {
  readonly source: FakeFlumeSource

  constructor(
    diagnosticLog: MemoryConnectorDiagnosticLog,
    private readonly signal: AbortSignal,
  ) {
    super({ type: "slack", connectorId: "co-1", channelId: "ch-1", diagnosticLog })
    this.source = new FakeFlumeSource()
  }

  async start(): Promise<void> {
    await this.runStart({
      source: this.source,
      onEvent: () => {},
      signal: this.signal,
    })
  }

  emitStatus(status: FlumeStatus, detail?: string): void {
    const event: StatusEvent = { source: "slack", status, detail: detail ?? null }
    this.handleStatus(event)
  }
}

class TestListener extends FunnelFlumeSourceListener {
  resetCount = 0
  readonly source: FakeFlumeSource

  constructor(diagnosticLog: MemoryConnectorDiagnosticLog, hooks: FakeHooks = {}) {
    super({
      type: "slack",
      connectorId: "co-1",
      channelId: "ch-1",
      diagnosticLog,
    })
    this.source = new FakeFlumeSource(hooks)
  }

  async start(): Promise<void> {
    await this.runStart({
      source: this.source,
      onEvent: () => {},
    })
  }

  async startWithHandler(onEvent: FlumeEventHandler): Promise<void> {
    await this.runStart({ source: this.source, onEvent })
  }

  emitStatus(status: FlumeStatus, detail?: string): void {
    const event: StatusEvent = { source: "slack", status, detail: detail ?? null }
    this.handleStatus(event)
  }

  protected override onStop(): void {
    this.resetCount += 1
  }
}

describe("FunnelFlumeSourceListener", () => {
  test("records connected/disconnected on status transitions and flips alive accordingly", async () => {
    const log = new MemoryConnectorDiagnosticLog()
    const listener = new TestListener(log)

    await listener.start()
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

  test("stop records disconnected then stopped and calls onStop even when the source disconnect throws", async () => {
    // Flume 0.6 owns the stop pipeline and never re-throws a per-source
    // disconnect error to its caller (the runStop wrapper converts unexpected
    // throws into FlumeStopped). So our listener's stop() does not see a
    // disconnect error — it just sees a clean stop. We verify the lifecycle
    // still finalises and onStop fires.
    const log = new MemoryConnectorDiagnosticLog()
    const listener = new TestListener(log, { disconnectError: new Error("close kaput") })

    await listener.start()
    listener.emitStatus("connected")
    await listener.stop()

    expect(listener.isAlive()).toBe(false)
    expect(listener.resetCount).toBe(1)

    const rows = log.queryConnection({ type: "slack" }).map((r) => r.status)
    expect(rows).toContain("connected")
    expect(rows[rows.length - 1]).toBe("stopped")
  })

  test("runStart records error on a FlumeStartError and rethrows", async () => {
    const log = new MemoryConnectorDiagnosticLog()
    const listener = new TestListener(log, { connectError: new Error("socket refused") })

    await expect(listener.start()).rejects.toBeInstanceOf(Error)

    expect(listener.isAlive()).toBe(false)

    const errorRows = log
      .queryConnection({ type: "slack", status: "error" })
      .map((r) => r.detail ?? "")

    // Flume wraps the source error in FlumeStartError with a context message;
    // the original "socket refused" text is preserved in the chain.
    expect(errorRows.some((d) => d.includes("socket refused"))).toBe(true)
  })

  test("forwards an AbortSignal to the Flume so host shutdown propagates", async () => {
    const log = new MemoryConnectorDiagnosticLog()
    const controller = new AbortController()
    const listener = new TestListenerWithSignal(log, controller.signal)

    await listener.start()
    expect(listener.source.disconnectCalls).toBe(0)

    // Aborting the signal triggers Flume's internal auto-stop, which calls
    // source.disconnect on every source. Give Flume a few microtasks to
    // settle since runStop awaits source.stop() per source.
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(listener.source.disconnectCalls).toBeGreaterThan(0)
  })

  test("enables reconnect by default so the source receives a reconnect config", async () => {
    const log = new MemoryConnectorDiagnosticLog()
    const listener = new TestListener(log)

    await listener.start()
    // The base class always builds a Flume with reconnect enabled, so the
    // source's ctx.reconnect is the resolved config (non-null) — otherwise a
    // single Socket Mode close would leave us permanently dead.
    expect(listener.source.capturedCtx?.reconnect).not.toBeNull()
  })

  test("reconnecting status does not write a row but still flips alive off", async () => {
    const log = new MemoryConnectorDiagnosticLog()
    const listener = new TestListener(log)

    await listener.start()
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
