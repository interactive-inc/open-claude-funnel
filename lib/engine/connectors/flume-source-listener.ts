import { invokeCallback } from "@/invoke-callback"
import { ObservedFunnelLogger } from "@/engine/logger/observed-logger"
import {
  Flume,
  FlumeRunning,
  type FlumeEventHandler,
  type FlumeLog,
  type FlumeLogHandler,
  type FlumeReconnectOptions,
  type FlumeRuntimeDeps,
  type FlumeSource,
  type FlumeStatus,
  type FlumeStreamItem,
} from "@interactive-inc/flume"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { FunnelConnectorDiagnosticsRecorder } from "@/engine/connectors/connector-diagnostics-recorder"
import type { FunnelLogger } from "@/engine/logger/logger"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"

type Props = {
  /** Funnel connector type ("slack" / "discord" / "gh") — stamped onto diagnostic rows. */
  type: string
  connectorId: string
  channelId: string | null
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
}

type RunStartOptions = {
  sources: ReadonlyArray<FlumeSource>
  /** Typed event handler — receives the source's events only (logs are routed separately). */
  onEvent: FlumeEventHandler
  /** Optional log handler for everything the firehose emits (including status transitions). */
  onLog?: FlumeLogHandler
  deps?: FlumeRuntimeDeps
  /**
   * Optional AbortSignal forwarded to the underlying Flume. When aborted, the
   * Flume auto-closes every source and resolves to `FlumeClosed`. Use this to
   * propagate a host-level shutdown (SIGTERM, listener registry stop, parent timeout)
   * down to the WebSocket layer without racing through `stop()`.
   */
  signal?: AbortSignal
  /**
   * Reconnect policy override forwarded to the Flume. The base class enables
   * reconnect with Flume's defaults (infinite attempts, 1s base / 30s max
   * exponential backoff with jitter) so a wifi drop or upstream socket close
   * is auto-recovered. Subclasses can pass a stricter `{ maxAttempts, ... }`
   * or `false` to opt out of reconnect entirely. Defaults to `true`.
   */
  reconnect?: boolean | FlumeReconnectOptions
}

/**
 * Status event reconstructed from the firehose `status` log entry. Funnel
 * keeps its own shape because Flume 0.9 collapsed the dedicated `onStatus`
 * callback into the unified `onEvent` firehose — state transitions now arrive
 * as `log.action === "status"` entries with `detail: { from, to, reason }`.
 */
type StatusEvent = {
  source: string
  status: FlumeStatus
  detail: string | null
}

/**
 * Shared lifecycle for any listener whose transport is a `FlumeSource`. Owns
 * the per-listener `Flume` instance + the `FlumeRunning` handle returned by
 * `open()`, the live source status, the `FlumeStatus ↔
 * ConnectorConnectionStatus` mapping, and the close sequence — every Flume
 * subclass plugs in only its own token resolution, source construction, and
 * event dispatch around this skeleton.
 *
 * Flume 0.9 collapsed every observation channel into one firehose: events
 * and all logs arrive through `onEvent` as a discriminated union
 * (`{ kind: "event" } | { kind: "log" }`). This base class splits that back
 * into the funnel-shaped trio (typed event handler, log forward, status
 * mapping) so subclasses keep their per-protocol code unchanged.
 */
export abstract class FunnelFlumeSourceListener extends FunnelConnectorListener {
  protected readonly logger: FunnelLogger | undefined
  protected readonly diagnostics: FunnelConnectorDiagnosticsRecorder
  protected readonly type: string
  protected running: FlumeRunning | null = null
  /** Flume owns the bounded queue; stopping never waits for a host callback. */
  private delivery: AsyncIterableIterator<FlumeStreamItem> | null = null
  private stopTask: Promise<void> | null = null
  private startController: AbortController | null = null

  constructor(props: Props) {
    super()
    this.type = props.type
    const logger = props.logger
    this.logger = logger ? new ObservedFunnelLogger(logger, () => {}) : undefined
    const diagnosticLog = props.diagnosticLog
    const context = { connectorId: props.connectorId, channelId: props.channelId }
    const reportDiagnosticError = (error: unknown) =>
      this.logger?.error(`${this.type} diagnostic callback failed`, {
        ...context,
        error: errorMessageOf(error),
      })
    this.diagnostics = new FunnelConnectorDiagnosticsRecorder({
      type: this.type,
      ...context,
      log: diagnosticLog
        ? {
            recordRaw: (record) =>
              invokeCallback(() => diagnosticLog.recordRaw(record), reportDiagnosticError),
            recordProcessed: (record) =>
              invokeCallback(() => diagnosticLog.recordProcessed(record), reportDiagnosticError),
            recordConnection: (record) =>
              invokeCallback(() => diagnosticLog.recordConnection(record), reportDiagnosticError),
          }
        : undefined,
    })
  }

  /** Own direct startup cancellation before a Flume handle exists. */
  protected async startLifecycle(
    signal: AbortSignal | undefined,
    start: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.startController || this.running || this.stopTask)
      throw new Error(`${this.type} listener is already starting or running`)
    signal?.throwIfAborted()
    const controller = new AbortController()
    this.startController = controller
    const scoped = signal ? AbortSignal.any([controller.signal, signal]) : controller.signal
    try {
      await start(scoped)
      scoped.throwIfAborted()
    } catch (error) {
      controller.abort()
      if (this.startController === controller) {
        try {
          await this.stop()
        } catch (cleanupError) {
          this.reportError(cleanupError, "startup cleanup")
        }
      }
      throw error
    }
  }

  /**
   * Assemble a single-source Flume, open it, and store the `FlumeRunning`
   * handle. Records `error` on any `Error` returned by `flume.open()` and
   * rethrows so the listener registry sees the failure.
   *
   * The firehose handler routes:
   *   - `kind: "event"`   → subclass's typed `onEvent`
   *   - `kind: "log"` with `action === "status"` → `handleStatus()`
   *   - `kind: "log"` (any)                     → optional `onLog` handler
   */
  protected async runStart(options: RunStartOptions): Promise<void> {
    const reconnectOption = options.reconnect ?? true
    const flumeReconnect =
      reconnectOption === false ? undefined : reconnectOption === true ? {} : reconnectOption

    const handleItem = (item: FlumeStreamItem): void => {
      if (item.kind === "event") return

      const log = item.log
      const statusEvent = readStatusLog(log)
      if (statusEvent) this.handleStatus(statusEvent)

      // Host observers may be async despite Flume's void callback type.
      // Observe their failure without making source shutdown await itself.
      invokeCallback(
        () => options.onLog?.(log),
        (error) => this.reportError(error, "log observer"),
      )
    }

    const flumeOptions: {
      sources: ReadonlyArray<FlumeSource>
      onEvent: (item: FlumeStreamItem) => void
      deps?: FlumeRuntimeDeps
      signal?: AbortSignal
      reconnect?: FlumeReconnectOptions
    } = {
      sources: options.sources,
      onEvent: handleItem,
    }

    if (options.deps) flumeOptions.deps = options.deps
    if (options.signal) flumeOptions.signal = options.signal
    if (flumeReconnect) flumeOptions.reconnect = flumeReconnect

    const flume = new Flume(flumeOptions)

    const result = await flume.open()

    // Branch on the abstract `Error` rather than the concrete
    // `FlumeStartError`: future flume versions may introduce additional
    // error subclasses (FlumeOpenError, FlumeAbortedError) in the same
    // result union, and a stricter `instanceof FlumeStartError` check would
    // silently assign them to `this.running: FlumeRunning`, leaving the
    // listener half-started with a broken handle. `Error` is the documented
    // discriminant for the result union.
    if (result instanceof Error) {
      this.reportError(result, "start")
      throw result
    }

    if (options.signal?.aborted) {
      await result.close()
      await result.drain()
      throw options.signal.reason ?? new Error("listener startup canceled")
    }
    this.running = result
    const delivery = result.stream()
    this.delivery = delivery
    // Do not await this pump: a host callback may itself await stop().
    void this.pumpDelivery(delivery, options.onEvent)
  }

  private reportError(error: unknown, context: string): void {
    const message = errorMessageOf(error)
    // Error observers are host code too. Neither sink may turn a handled
    // rejection into a second unhandled rejection or suppress the other sink.
    try {
      this.diagnostics.recordConnection("error", message)
    } catch {}
    try {
      void Promise.resolve(
        this.logger?.error(`${this.type} ${context} error`, { error: message }),
      ).catch(() => {})
    } catch {}
  }

  private async pumpDelivery(
    delivery: AsyncIterableIterator<FlumeStreamItem>,
    onEvent: FlumeEventHandler,
  ): Promise<void> {
    try {
      for await (const item of delivery) {
        if (this.delivery !== delivery) break
        if (item.kind !== "event") continue
        try {
          await onEvent(item.event)
        } catch (error) {
          this.reportError(error, "delivery")
        }
      }
    } catch (error) {
      this.reportError(error, "stream")
    }
  }

  async stop(): Promise<void> {
    const controller = this.startController
    controller?.abort()
    try {
      await this.stopSources()
    } finally {
      if (this.startController === controller) this.startController = null
    }
  }

  private async stopSources(): Promise<void> {
    if (this.stopTask) return this.stopTask
    const running = this.running
    if (!running) return

    // Install the guard before source cleanup or observer callbacks can reenter.
    const task = Promise.resolve().then(() => this.stopRunning(running))
    this.stopTask = task
    try {
      await task
    } finally {
      if (this.stopTask === task) this.stopTask = null
    }
  }

  private async stopRunning(running: FlumeRunning): Promise<void> {
    const delivery = this.delivery
    this.delivery = null
    try {
      await delivery?.return?.()
      const closed = await running.close()
      // Flume 0.11 separates source shutdown from callback completion.
      // Finish queued status/log callbacks before finalizing listener state.
      await running.drain()
      for (const { error } of closed.errors()) {
        this.reportError(error, "stop")
      }
      this.diagnostics.recordConnection("disconnected", "")
    } catch (error) {
      this.reportError(error, "stop")
    } finally {
      this.running = null
      this.onStop()
      this.diagnostics.recordConnection("stopped", "")
    }
  }

  override isAlive(): boolean {
    const statuses = this.running?.statuses() ?? []
    // The handle exists only after open. Connecting now means an active
    // retry; only a terminal disconnect belongs to registry recovery.
    return statuses.length > 0 && statuses.every(({ status }) => status !== "disconnected")
  }

  override isConnected(): boolean {
    const statuses = this.running?.statuses() ?? []
    return statuses.length > 0 && statuses.every(({ status }) => status === "connected")
  }

  /** Status logs are history only; health checks read Flume's live snapshot. */
  protected handleStatus(event: StatusEvent): void {
    if (event.status === "connected") {
      this.diagnostics.recordConnection("connected", event.detail ?? "")
    } else if (event.status === "disconnected" || event.status === "reconnecting") {
      this.diagnostics.recordConnection(
        "disconnected",
        event.detail ?? (event.status === "reconnecting" ? "reconnecting" : ""),
      )
    }
  }

  /**
   * Hook for subclass-specific cleanup that has to run inside the stop()
   * finally block (after the running handle is cleared, before the `stopped`
   * row is recorded). Default is no-op.
   */
  protected onStop(): void {}
}

const STATUS_VALUES: ReadonlyArray<FlumeStatus> = [
  "disconnected",
  "connecting",
  "connected",
  "reconnecting",
]

const isFlumeStatus = (value: unknown): value is FlumeStatus =>
  typeof value === "string" && (STATUS_VALUES as ReadonlyArray<string>).includes(value)

/**
 * Reconstructs the old `FlumeStatusEvent` shape from a `status` log entry.
 * Returns `null` for anything else so the firehose pump is a single check.
 * Flume 0.9 emits these as `log.action === "status"` with a structured
 * `detail: { from, to, reason }` payload (see flume's FlumeStatusEmitter).
 */
const readStatusLog = (log: FlumeLog): StatusEvent | null => {
  if (log.action !== "status") return null
  const detail = log.detail
  if (!detail) return null

  const to = detail.to
  if (!isFlumeStatus(to)) return null

  const reason = typeof detail.reason === "string" ? detail.reason : null

  return { source: log.source, status: to, detail: reason }
}
