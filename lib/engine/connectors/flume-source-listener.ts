import type {
  FlumeHandler,
  FlumeSource,
  FlumeStatus,
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

/**
 * Shared lifecycle for any listener whose transport is a `FlumeSource`.
 * Owns the `source` handle, the connected/alive bit, the `FlumeStatus ↔
 * ConnectorConnectionStatus` mapping, and the stop sequence — every flume
 * subclass plugs in its own token resolution, source construction, and event
 * dispatch around this skeleton.
 *
 * Subclasses:
 *   1. Record any pre-start diagnostics (e.g. auth-failed during token resolution).
 *   2. Build the flume source with `onStatus: (s, d) => this.handleStatus(s, d)`.
 *   3. Call `await this.runStart(source, handler)` with the per-source-name guarded handler.
 *   4. Override `onStop()` to clear any extra state (processor refs, cached ids).
 */
export abstract class FunnelFlumeSourceListener extends FunnelConnectorListener {
  protected readonly logger: FunnelLogger | undefined
  protected readonly diagnostics: FunnelConnectorDiagnosticsRecorder
  protected readonly type: string
  protected source: FlumeSource | null = null
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
   * Attach the constructed flume source and run its `start()`. Branches on
   * the 0.4 `Promise<Error | null>` return: records `error` on the connection
   * table and rethrows so the supervisor sees the failure, otherwise the
   * listener is now live (the source's own `onStatus` will record `connected`
   * once the upstream socket opens).
   */
  protected async runStart(source: FlumeSource, handler: FlumeHandler): Promise<void> {
    this.source = source

    const startError = await source.start(handler)

    if (startError instanceof Error) {
      this.diagnostics.recordConnection("error", errorMessageOf(startError))
      throw startError
    }
  }

  async stop(): Promise<void> {
    if (!this.source) return

    try {
      await this.source.stop()
      this.diagnostics.recordConnection("disconnected", "")
    } catch (error) {
      this.diagnostics.recordConnection("error", errorMessageOf(error))
      this.logger?.error(`${this.type} stop error`, { error: errorMessageOf(error) })
    } finally {
      this.source = null
      this.connected = false
      this.onStop()
      this.diagnostics.recordConnection("stopped", "")
    }
  }

  override isAlive(): boolean {
    return this.source !== null && this.connected
  }

  /**
   * Maps flume's transport status to the connection table. `reconnecting`
   * deliberately produces no row — flume drives many transient reconnects per
   * minute on a flaky network, and the row would drown the more meaningful
   * `connected`/`disconnected` pair. The `connected` flag still flips so
   * `isAlive()` is honest.
   */
  protected handleStatus(status: FlumeStatus, detail?: string): void {
    if (status === "connected") {
      this.connected = true
      this.diagnostics.recordConnection("connected", detail ?? "")
      return
    }

    if (status === "disconnected") {
      this.connected = false
      this.diagnostics.recordConnection("disconnected", detail ?? "")
      return
    }

    if (status === "reconnecting") {
      this.connected = false
    }
  }

  /**
   * Hook for subclass-specific cleanup that has to run inside the stop()
   * finally block (after the source is nulled and the connected flag is
   * cleared, before the `stopped` row is recorded). Default is no-op.
   */
  protected onStop(): void {}
}
