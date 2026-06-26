import {
  Flume,
  FlumeRunning,
  FlumeStartError,
  type FlumeEventHandler,
  type FlumeLogHandler,
  type FlumeRuntimeDeps,
  type FlumeSource,
  type FlumeStatusEvent,
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
  onEvent: FlumeEventHandler
  onLog?: FlumeLogHandler
  deps?: FlumeRuntimeDeps
  /**
   * Optional AbortSignal forwarded to the underlying Flume. When aborted, the
   * Flume auto-stops every source and resolves to `FlumeStopped`. Use this to
   * propagate a host-level shutdown (SIGTERM, supervisor stop, parent timeout)
   * down to the WebSocket layer without racing through `stop()`.
   */
  signal?: AbortSignal
}

/**
 * Shared lifecycle for any listener whose transport is a `FlumeSource`. Owns
 * the per-listener `Flume` instance + the `FlumeRunning` handle returned by
 * `start()`, the connected/alive bit, the `FlumeStatus ↔
 * ConnectorConnectionStatus` mapping, and the stop sequence — every Flume
 * subclass plugs in only its own token resolution, source construction, and
 * event dispatch around this skeleton.
 *
 * In Flume 0.6 the cross-cutting concerns (`onEvent`, `onLog`, `onStatus`,
 * `reconnect`, `deps`) live on the `Flume` constructor, not on each source;
 * the source ctor takes only protocol-specific options (tokens, intents,
 * pollInterval). This base wires the Flume side once so subclasses do not
 * each re-implement the assembly.
 */
export abstract class FunnelFlumeSourceListener extends FunnelConnectorListener {
  protected readonly logger: FunnelLogger | undefined
  protected readonly diagnostics: FunnelConnectorDiagnosticsRecorder
  protected readonly type: string
  protected running: FlumeRunning | null = null
  protected connected = false

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
   * Assemble a single-source Flume, start it, and store the `FlumeRunning`
   * handle. Records `error` on a `FlumeStartError` and rethrows so the
   * supervisor sees the failure. The `onStatus` mapping into the diagnostics
   * table is wired here so subclasses do not each repeat it.
   */
  protected async runStart(options: RunStartOptions): Promise<void> {
    const flume = new Flume([options.source], {
      onEvent: options.onEvent,
      onLog: options.onLog,
      deps: options.deps,
      signal: options.signal,
      onStatus: (event) => this.handleStatus(event),
    })

    const result = await flume.start()

    if (result instanceof FlumeStartError) {
      this.diagnostics.recordConnection("error", errorMessageOf(result))
      throw result
    }

    this.running = result
  }

  async stop(): Promise<void> {
    if (!this.running) return

    try {
      await this.running.stop()
      this.diagnostics.recordConnection("disconnected", "")
    } catch (error) {
      this.diagnostics.recordConnection("error", errorMessageOf(error))
      this.logger?.error(`${this.type} stop error`, { error: errorMessageOf(error) })
    } finally {
      this.running = null
      this.connected = false
      this.onStop()
      this.diagnostics.recordConnection("stopped", "")
    }
  }

  override isAlive(): boolean {
    return this.running !== null && this.connected
  }

  /**
   * Maps Flume's transport status to the connection table. `reconnecting`
   * deliberately produces no row — Flume drives many transient reconnects per
   * minute on a flaky network, and the row would drown the more meaningful
   * `connected`/`disconnected` pair. The `connected` flag still flips so
   * `isAlive()` is honest.
   */
  protected handleStatus(event: FlumeStatusEvent): void {
    if (event.status === "connected") {
      this.connected = true
      this.diagnostics.recordConnection("connected", event.detail ?? "")
      return
    }

    if (event.status === "disconnected") {
      this.connected = false
      this.diagnostics.recordConnection("disconnected", event.detail ?? "")
      return
    }

    if (event.status === "reconnecting") {
      this.connected = false
    }
  }

  /**
   * Hook for subclass-specific cleanup that has to run inside the stop()
   * finally block (after the running handle is cleared, before the `stopped`
   * row is recorded). Default is no-op.
   */
  protected onStop(): void {}
}
