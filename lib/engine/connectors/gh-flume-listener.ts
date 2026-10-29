import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import { FlumeGitHubSource } from "@interactive-inc/flume/github"
import type { FlumeGitHubEvent, FlumeRuntimeDeps } from "@interactive-inc/flume"
import type { NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { flumeLogHandler, resolveFlumeDeps } from "@/engine/connectors/flume-deps"
import { FunnelFlumeSourceListener } from "@/engine/connectors/flume-source-listener"
import { listenerSignal } from "@/engine/connectors/listener-signal"
import type { FunnelLogger } from "@/engine/logger/logger"
import type { ConnectorDiagnosticLog } from "@/engine/diagnostic-log/diagnostic-log"
import type { GhConnectorConfig } from "@/engine/connectors/gh-connector-schema"

type Deps = {
  config: GhConnectorConfig
  channelId?: string
  env?: NodeJS.ProcessEnv
  logger?: FunnelLogger
  diagnosticLog?: ConnectorDiagnosticLog
  flumeDeps?: Partial<FlumeRuntimeDeps>
  /** Shutdown signal forwarded to the underlying Flume. */
  signal?: AbortSignal
}

/** GitHub notifications over Flume, using host-supplied credentials. */
export class FunnelFlumeGhListener extends FunnelFlumeSourceListener {
  private readonly config: GhConnectorConfig
  private readonly env: NodeJS.ProcessEnv
  private readonly flumeDeps: Partial<FlumeRuntimeDeps>
  private readonly signal: AbortSignal | undefined

  constructor(deps: Deps) {
    super({
      type: "gh",
      connectorId: deps.config.id,
      channelId: deps.channelId ?? null,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
    })
    this.config = deps.config
    this.env = deps.env ?? process.env
    this.flumeDeps = deps.flumeDeps ?? {}
    this.signal = deps.signal
  }

  async start(notify: NotifyFn, signal?: AbortSignal): Promise<void> {
    await this.startLifecycle(listenerSignal(this.signal, signal), (startupSignal) =>
      this.startScope(notify, startupSignal),
    )
  }

  private async startScope(notify: NotifyFn, startupSignal: AbortSignal): Promise<void> {
    startupSignal?.throwIfAborted()
    this.diagnostics.recordConnection("started", "")

    let token: string

    try {
      token = await this.resolveToken()
    } catch (error) {
      this.diagnostics.recordConnection("auth-failed", errorMessageOf(error))
      throw error
    }

    startupSignal?.throwIfAborted()

    // Source ctor takes only protocol-specific options in Flume 0.9.
    const source = new FlumeGitHubSource({
      token,
      pollInterval: this.config.pollInterval ?? 60,
    })

    await this.runStart({
      sources: [source],
      onLog: flumeLogHandler(this.logger),
      deps: resolveFlumeDeps(this.flumeDeps),
      signal: startupSignal,
      onEvent: (event) => {
        if (event.source !== "github") return Promise.resolve()
        return this.handleEvent(event, notify)
      },
    })
  }

  private async resolveToken(): Promise<string> {
    return resolveConnectorToken({
      literal: this.config.token,
      envVar: this.config.tokenEnv,
      env: this.env,
      label: `${this.config.name}.token`,
    })
  }

  private async handleEvent(event: FlumeGitHubEvent, notify: NotifyFn): Promise<void> {
    const eventId = event.data.id
    const rawJson = JSON.stringify(event.data)

    this.diagnostics.recordRaw(eventId, rawJson)

    // Flume's extractGitHubMeta sets event_type="notification"; the funnel
    // contract is event_type=<connector type>, so the literal wins. We also
    // re-surface subject_url and updated_at from the raw notification because
    // the MCP usage hint extracts issue/PR numbers from subject.url.
    const meta: Record<string, string> = {
      ...event.meta,
      event_type: "gh",
      subject_url: event.data.subject.url ?? "",
      updated_at: event.data.updated_at,
    }

    await this.deliver(notify, eventId, rawJson, meta)
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
