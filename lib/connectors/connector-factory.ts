import type { FunnelConnectorAdapter } from "@/connectors/connector-adapter"
import type { ConnectorConfig } from "@/connectors/connector-config-schema"
import type { FunnelConnectorListener } from "@/connectors/connector-listener"
import { FunnelDiscordAdapter } from "@/connectors/discord-adapter"
import { FunnelDiscordListener } from "@/connectors/discord-listener"
import { FunnelGhAdapter } from "@/connectors/gh-adapter"
import { FunnelGhListener } from "@/connectors/gh-listener"
import { FunnelScheduleListener, type ScheduleOnFired } from "@/connectors/schedule-listener"
import { ScheduleStateStore } from "@/connectors/schedule-state-store"
import { FunnelSlackAdapter } from "@/connectors/slack-adapter"
import {
  FunnelSlackListener,
  type SlackOnAppCreated,
  type SlackPreprocessEvent,
} from "@/connectors/slack-listener"
import type { ConnectorDiagnosticLog } from "@/gateway/connector-diagnostic-log"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelLogger } from "@/engine/logger/logger"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FUNNEL_DIR } from "@/engine/settings/settings-store"
import { join } from "node:path"

export type SlackListenerOptions = {
  onAppCreated?: SlackOnAppCreated
  preprocessEvent?: SlackPreprocessEvent
}

export type ScheduleListenerOptions = {
  onFired?: ScheduleOnFired
}

type Deps = {
  fs?: FunnelFileSystem
  process?: FunnelProcessRunner
  logger?: FunnelLogger
  dir?: string
  /** Diagnostic log of inbound connector traffic. Threaded into listeners that record raw/processed events. No-op when absent. */
  diagnosticLog?: ConnectorDiagnosticLog
  /** Per-listener hooks for the slack connector type. Threaded into every Slack listener built by this factory. */
  slackListenerOptions?: SlackListenerOptions
  /** Per-listener hooks for the schedule connector type. Threaded into every Schedule listener built by this factory. */
  scheduleListenerOptions?: ScheduleListenerOptions
}

const defaultFs = new NodeFunnelFileSystem()
const defaultProcess = new NodeFunnelProcessRunner()

/**
 * Pure factory for per-type listeners and adapters. The factory has no CRUD
 * responsibility — connector configs live inside settings.json under their
 * channel, and FunnelChannels passes them in by value.
 *
 * `dir` is the funnel home (defaults to ~/.funnel); per-connector state files
 * land at `<dir>/channels/<channel-id>/connectors/<connector-id>/state.json`.
 *
 * Host integrations can supply per-type listener hooks via
 * `slackListenerOptions` / `scheduleListenerOptions` — e.g. to attach a
 * Bolt `app.action` handler or to drop one-shot schedule entries on fire.
 */
export class FunnelConnectorFactory {
  private readonly fs: FunnelFileSystem
  private readonly process: FunnelProcessRunner
  private readonly logger: FunnelLogger | undefined
  private readonly diagnosticLog: ConnectorDiagnosticLog | undefined
  private readonly dir: string
  private readonly slackListenerOptions: SlackListenerOptions
  private readonly scheduleListenerOptions: ScheduleListenerOptions

  constructor(deps: Deps = {}) {
    this.fs = deps.fs ?? defaultFs
    this.process = deps.process ?? defaultProcess
    this.logger = deps.logger
    this.diagnosticLog = deps.diagnosticLog
    this.dir = deps.dir ?? FUNNEL_DIR
    this.slackListenerOptions = deps.slackListenerOptions ?? {}
    this.scheduleListenerOptions = deps.scheduleListenerOptions ?? {}
    Object.freeze(this)
  }

  createListener(channelId: string, config: ConnectorConfig): FunnelConnectorListener {
    if (config.type === "slack") {
      return new FunnelSlackListener({
        config,
        channelId,
        logger: this.logger,
        diagnosticLog: this.diagnosticLog,
        onAppCreated: this.slackListenerOptions.onAppCreated,
        preprocessEvent: this.slackListenerOptions.preprocessEvent,
      })
    }

    if (config.type === "gh") {
      return new FunnelGhListener({
        config,
        channelId,
        process: this.process,
        logger: this.logger,
        diagnosticLog: this.diagnosticLog,
      })
    }

    if (config.type === "discord") {
      return new FunnelDiscordListener({
        config,
        channelId,
        logger: this.logger,
        diagnosticLog: this.diagnosticLog,
      })
    }

    const lastFiredStore = new ScheduleStateStore({
      path: join(this.connectorDir(channelId, config.id), "state.json"),
      fs: this.fs,
    })

    return new FunnelScheduleListener({
      config,
      lastFiredStore,
      channelId,
      logger: this.logger,
      diagnosticLog: this.diagnosticLog,
      onFired: this.scheduleListenerOptions.onFired,
    })
  }

  createAdapter(config: ConnectorConfig): FunnelConnectorAdapter | null {
    if (config.type === "slack") return new FunnelSlackAdapter({ config })
    if (config.type === "gh") return new FunnelGhAdapter({ process: this.process })
    if (config.type === "discord") return new FunnelDiscordAdapter({ config })

    return null
  }

  connectorDir(channelId: string, connectorId: string): string {
    return join(this.dir, "channels", channelId, "connectors", connectorId)
  }

  channelDir(channelId: string): string {
    return join(this.dir, "channels", channelId)
  }
}
