import { FlumeGitHubSource } from "@interactive-inc/flume/github"
import type { FlumeEvent, FlumeRuntimeDeps, FlumeStatus } from "@interactive-inc/flume"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { flumeLogHandler, flumeRuntimeDeps } from "@/engine/connectors/flume-deps"
import { FunnelConnectorDiagnosticsRecorder } from "@/engine/connectors/connector-diagnostics-recorder"
import { FunnelLogger } from "@/engine/logger/logger"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { GhConnectorConfig } from "@/engine/connectors/gh-connector-schema"

type Deps = {
  config: GhConnectorConfig
  channelId?: string
  env?: NodeJS.ProcessEnv
  process?: FunnelProcessRunner
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  flumeDeps?: Partial<FlumeRuntimeDeps>
}

const defaultProcess = new NodeFunnelProcessRunner()

const readNotificationId = (notification: unknown): string | null => {
  if (typeof notification !== "object" || notification === null) return null
  if (!("id" in notification)) return null

  const record: Record<string, unknown> = notification

  return typeof record.id === "string" ? record.id : null
}

/**
 * GitHub listener backed by `@interactive-inc/flume`'s `FlumeGitHubSource`
 * (raw REST polling of `/notifications` + Zod).
 *
 * Token resolution order mirrors the other connectors' literal-or-env-ref
 * slot, with a `gh auth token` fallback as the convenience path:
 *
 *   1. `config.token` (literal)
 *   2. `config.tokenEnv` (env var name → value)
 *   3. `gh auth token` (reuses the `gh` CLI's authenticated session)
 *
 * The adapter still uses `gh api` for outbound calls, so when the fallback
 * is in use the auth model is unchanged end-to-end.
 */
export class FunnelFlumeGhListener extends FunnelConnectorListener {
  private readonly config: GhConnectorConfig
  private readonly env: NodeJS.ProcessEnv
  private readonly process: FunnelProcessRunner
  private readonly logger: FunnelLogger | undefined
  private readonly flumeDeps: Partial<FlumeRuntimeDeps>
  private readonly diagnostics: FunnelConnectorDiagnosticsRecorder
  private source: FlumeGitHubSource | null = null
  private connected = false

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.env = deps.env ?? process.env
    this.process = deps.process ?? defaultProcess
    this.logger = deps.logger
    this.flumeDeps = deps.flumeDeps ?? {}
    this.diagnostics = new FunnelConnectorDiagnosticsRecorder({
      type: "gh",
      connectorId: deps.config.id,
      channelId: deps.channelId ?? null,
      log: deps.diagnosticLog,
    })
  }

  async start(notify: NotifyFn): Promise<void> {
    this.diagnostics.recordConnection("started", "")

    const token = await this.resolveToken()

    const source = new FlumeGitHubSource({
      token,
      pollInterval: this.config.pollInterval ?? 60,
      reconnect: false,
      onLog: flumeLogHandler(this.logger),
      onStatus: (status, detail) => this.handleStatus(status, detail),
      deps: { ...flumeRuntimeDeps(), ...this.flumeDeps },
    })

    this.source = source

    try {
      await source.start((event) => this.handleEvent(event, notify))
    } catch (error) {
      this.diagnostics.recordConnection("error", errorMessageOf(error))
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this.source) return

    try {
      await this.source.stop()
      this.diagnostics.recordConnection("disconnected", "")
    } catch (error) {
      this.diagnostics.recordConnection("error", errorMessageOf(error))
      this.logger?.error("gh stop error", { error: errorMessageOf(error) })
    } finally {
      this.source = null
      this.connected = false
      this.diagnostics.recordConnection("stopped", "")
    }
  }

  override isAlive(): boolean {
    return this.source !== null && this.connected
  }

  private async resolveToken(): Promise<string> {
    if (this.config.token) return this.config.token

    if (this.config.tokenEnv) {
      const fromEnv = this.env[this.config.tokenEnv]

      if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv

      throw new Error(
        `${this.config.name}.token references env var "${this.config.tokenEnv}" but it is not set`,
      )
    }

    // Fall back to `gh auth token` — reuses the `gh` CLI's authenticated
    // session. Keeps the auth model identical to the original `gh api`
    // polling listener: no separate token management.
    const result = await this.process.run(["gh", "auth", "token"])

    if (result.exitCode !== 0) {
      throw new Error(`gh auth token failed: ${result.stderr.trim() || result.stdout.trim()}`)
    }

    return result.stdout.trim()
  }

  private handleStatus(status: FlumeStatus, detail?: string): void {
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

  private handleEvent(event: FlumeEvent, notify: NotifyFn): void {
    const eventId = readNotificationId(event.data) ?? crypto.randomUUID()
    const rawJson = JSON.stringify(event.data)

    this.diagnostics.recordRaw(eventId, rawJson)

    const meta: Record<string, string> = { event_type: "gh", ...event.meta }

    void this.deliver(notify, eventId, rawJson, meta)
  }

  private async deliver(
    notify: NotifyFn,
    eventId: string,
    content: string,
    meta: Record<string, string>,
  ): Promise<void> {
    try {
      await notify(content, meta)
    } catch (error) {
      this.diagnostics.recordProcessed(eventId, "emitted:delivery-failed", content)
      this.logger?.error("gh notify error", { error: errorMessageOf(error) })
      return
    }

    this.diagnostics.recordProcessed(eventId, "emitted", content)
  }
}
