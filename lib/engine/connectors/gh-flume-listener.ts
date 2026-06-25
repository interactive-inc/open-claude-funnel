import { FlumeGitHubSource } from "@interactive-inc/flume/github"
import type { FlumeGitHubEvent, FlumeRuntimeDeps } from "@interactive-inc/flume"
import type { NotifyFn } from "@/engine/connectors/connector-listener"
import { errorMessageOf } from "@/engine/error/error-message-of"
import { flumeLogHandler, resolveFlumeDeps } from "@/engine/connectors/flume-deps"
import { FunnelFlumeSourceListener } from "@/engine/connectors/flume-source-listener"
import type { FunnelLogger } from "@/engine/logger/logger"
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
export class FunnelFlumeGhListener extends FunnelFlumeSourceListener {
  private readonly config: GhConnectorConfig
  private readonly env: NodeJS.ProcessEnv
  private readonly process: FunnelProcessRunner
  private readonly flumeDeps: Partial<FlumeRuntimeDeps>

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
    this.process = deps.process ?? defaultProcess
    this.flumeDeps = deps.flumeDeps ?? {}
  }

  async start(notify: NotifyFn): Promise<void> {
    this.diagnostics.recordConnection("started", "")

    let token: string

    try {
      token = await this.resolveToken()
    } catch (error) {
      this.diagnostics.recordConnection("auth-failed", errorMessageOf(error))
      throw error
    }

    const source = new FlumeGitHubSource({
      token,
      pollInterval: this.config.pollInterval ?? 60,
      reconnect: false,
      onLog: flumeLogHandler(this.logger),
      onStatus: (status, detail) => this.handleStatus(status, detail),
      deps: resolveFlumeDeps(this.flumeDeps),
    })

    await this.runStart(source, (event) => {
      if (event.source !== "github") return
      this.handleEvent(event, notify)
    })
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

  private handleEvent(event: FlumeGitHubEvent, notify: NotifyFn): void {
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
