import type { FunnelConnectorAdapter } from "@/connectors/connector-adapter"
import type { ConnectorConfig } from "@/connectors/connector-config-schema"
import type { FunnelConnectorListener } from "@/connectors/connector-listener"
import { FunnelDiscordAdapter } from "@/connectors/discord-adapter"
import { FunnelDiscordListener } from "@/connectors/discord-listener"
import { FunnelGhAdapter } from "@/connectors/gh-adapter"
import { FunnelGhListener } from "@/connectors/gh-listener"
import { FunnelScheduleListener } from "@/connectors/schedule-listener"
import { ScheduleStateStore } from "@/connectors/schedule-state-store"
import { FunnelSlackAdapter } from "@/connectors/slack-adapter"
import { FunnelSlackListener } from "@/connectors/slack-listener"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelLogger } from "@/engine/logger/logger"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FUNNEL_DIR } from "@/engine/settings/settings-store"
import { join } from "node:path"

type Deps = {
  fs?: FunnelFileSystem
  process?: FunnelProcessRunner
  logger?: FunnelLogger
  dir?: string
}

const defaultFs = new NodeFunnelFileSystem()
const defaultProcess = new NodeFunnelProcessRunner()
const defaultLogger = new NodeFunnelLogger()

/**
 * Pure factory for per-type listeners and adapters. The factory has no CRUD
 * responsibility — connector configs live inside settings.json under their
 * channel, and FunnelChannels passes them in by value.
 *
 * `dir` is the funnel home (defaults to ~/.funnel); per-connector state files
 * land at `<dir>/channels/<channel-id>/connectors/<connector-id>/state.json`.
 */
export class FunnelConnectorFactory {
  private readonly fs: FunnelFileSystem
  private readonly process: FunnelProcessRunner
  private readonly logger: FunnelLogger
  private readonly dir: string

  constructor(deps: Deps = {}) {
    this.fs = deps.fs ?? defaultFs
    this.process = deps.process ?? defaultProcess
    this.logger = deps.logger ?? defaultLogger
    this.dir = deps.dir ?? FUNNEL_DIR
    Object.freeze(this)
  }

  createListener(channelId: string, config: ConnectorConfig): FunnelConnectorListener {
    if (config.type === "slack") {
      return new FunnelSlackListener({ config, logger: this.logger })
    }

    if (config.type === "gh") {
      return new FunnelGhListener({ config, process: this.process, logger: this.logger })
    }

    if (config.type === "discord") {
      return new FunnelDiscordListener({ config, logger: this.logger })
    }

    const lastFiredStore = new ScheduleStateStore({
      path: join(this.connectorDir(channelId, config.id), "state.json"),
      fs: this.fs,
    })

    return new FunnelScheduleListener({
      config,
      lastFiredStore,
      logger: this.logger,
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
