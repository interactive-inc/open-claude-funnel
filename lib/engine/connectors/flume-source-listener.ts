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
  source: FlumeSource
  /** Typed event handler — receives the source's events only (logs are routed separately). */
  onEvent: FlumeEventHandler
  /** Optional log handler for everything the firehose emits (including status transitions). */
  onLog?: FlumeLogHandler
  deps?: FlumeRuntimeDeps
  /**
   * Optional AbortSignal forwarded to the underlying Flume. When aborted, the
   * Flume auto-closes every source and resolves to `FlumeClosed`. Use this to
   * propagate a host-level shutdown (SIGTERM, supervisor stop, parent timeout)
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
 * `open()`, the connected/alive bit, the `FlumeStatus ↔
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
  protected connected = false
  /**
   * Flipped on by Flume's `reconnecting` status, off when the new socket
   * lands on `connected` or the source gives up with `disconnected`. Used by
   * `isAlive()` to treat a brief reconnect window as "still alive" so the
   * supervisor does not preempt Flume's in-progress recovery with a heavier
   * stop+start cycle (which would discard auth.test results and rebuild
   * every per-listener state).
   */
  protected reconnecting = false
  /**
   * Promise chain that serializes typed-event delivery. Flume's emitItem
   * fire-and-forgets the onEvent callback (see flume.ts emitItem:
   * `Promise.resolve(onEvent(item)).catch(() => {})`), so awaiting onEvent
   * inside the handler does NOT pause flume's source queue — multiple event
   * deliveries would race their microtask chains. Chaining each new event
   * onto the previous promise's `.then(...)` guarantees per-listener
   * end-to-end FIFO regardless of whether the notify path is sync or async.
   */
  private deliveryChain: Promise<void> = Promise.resolve()

  constructor(props: Props) {
    super()
    this.type = props.type
    this.logger = props.logger
    this.diagnostics = new FunnelConnectorDiagnosticsRecorder({
      type: props.type,
      connectorId: props.connectorId,
      channelId: props.channelId,
      log: props.diagnosticLog,
    })
  }

  /**
   * Assemble a single-source Flume, open it, and store the `FlumeRunning`
   * handle. Records `error` on any `Error` returned by `flume.open()` and
   * rethrows so the supervisor sees the failure.
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
      if (item.kind === "event") {
        // Append to the per-listener delivery chain so each event's full
        // delivery (notify + diagnostic write) completes before the next
        // one starts — even when flume's emitItem fires onEvent without
        // awaiting it. The `.catch(() => {})` between steps keeps a single
        // failed delivery from breaking the chain for everything after.
        this.deliveryChain = this.deliveryChain
          .catch(() => {})
          .then(() => Promise.resolve(options.onEvent(item.event)))
        return
      }

      const log = item.log
      const statusEvent = readStatusLog(log)
      if (statusEvent) this.handleStatus(statusEvent)

      options.onLog?.(log)
    }

    const flumeOptions: {
      sources: ReadonlyArray<FlumeSource>
      onEvent: (item: FlumeStreamItem) => void
      deps?: FlumeRuntimeDeps
      signal?: AbortSignal
      reconnect?: FlumeReconnectOptions
    } = {
      sources: [options.source],
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
      this.diagnostics.recordConnection("error", errorMessageOf(result))
      throw result
    }

    this.running = result
  }

  async stop(): Promise<void> {
    if (!this.running) return

    try {
      await this.running.close()
      this.diagnostics.recordConnection("disconnected", "")
    } catch (error) {
      this.diagnostics.recordConnection("error", errorMessageOf(error))
      this.logger?.error(`${this.type} stop error`, { error: errorMessageOf(error) })
    } finally {
      this.running = null
      this.connected = false
      this.reconnecting = false
      // Reset the chain so the next start() does not inherit a settled
      // promise from the previous lifecycle (preserves the invariant that
      // the chain head reflects this lifecycle's deliveries only).
      this.deliveryChain = Promise.resolve()
      this.onStop()
      this.diagnostics.recordConnection("stopped", "")
    }
  }

  override isAlive(): boolean {
    if (this.running === null) return false

    // Treat an in-progress reconnect as still alive so the supervisor's
    // 30s health check does not preempt Flume's internal retry. Flume's
    // reconnect default (infinite attempts, 1s base / 30s max backoff) is
    // usually faster than the supervisor's stop+start+auth.test cycle, so
    // letting it finish recovers Slack notifications sooner with less
    // diagnostic noise.
    return this.connected || this.reconnecting
  }

  /**
   * Maps Flume's transport status to the connection table. `reconnecting`
   * deliberately produces no row — Flume drives many transient reconnects per
   * minute on a flaky network, and the row would drown the more meaningful
   * `connected`/`disconnected` pair. The `reconnecting` flag still flips so
   * `isAlive()` can surface it to the supervisor.
   */
  protected handleStatus(event: StatusEvent): void {
    if (event.status === "connected") {
      this.connected = true
      this.reconnecting = false
      this.diagnostics.recordConnection("connected", event.detail ?? "")
      return
    }

    if (event.status === "disconnected") {
      this.connected = false
      this.reconnecting = false
      this.diagnostics.recordConnection("disconnected", event.detail ?? "")
      return
    }

    if (event.status === "reconnecting") {
      this.connected = false
      this.reconnecting = true
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
