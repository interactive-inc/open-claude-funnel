import type {
  ConnectorConnectionStatus,
  ConnectorDiagnosticLog,
} from "@/engine/diagnostic-log/diagnostic-log"

type Props = {
  type: string
  connectorId: string | null
  channelId: string | null
  log: ConnectorDiagnosticLog | undefined
}

/**
 * Wraps a `ConnectorDiagnosticLog` with the per-listener axes (`type` /
 * `connectorId` / `channelId`) so call sites only pass the row-specific
 * fields. When no log is wired every call is a silent no-op.
 */
export class FunnelConnectorDiagnosticsRecorder {
  constructor(private readonly props: Props) {
    Object.freeze(this)
  }

  recordRaw(eventId: string, payload: string): void {
    this.props.log?.recordRaw({
      eventId,
      type: this.props.type,
      connectorId: this.props.connectorId,
      channelId: this.props.channelId,
      payload,
    })
  }

  recordProcessed(eventId: string, outcome: string, payload: string): void {
    this.props.log?.recordProcessed({
      eventId,
      type: this.props.type,
      connectorId: this.props.connectorId,
      channelId: this.props.channelId,
      outcome,
      payload,
    })
  }

  recordConnection(status: ConnectorConnectionStatus, detail: string): void {
    this.props.log?.recordConnection({
      type: this.props.type,
      connectorId: this.props.connectorId,
      channelId: this.props.channelId,
      status,
      detail,
    })
  }
}
