import {
  FunnelConnectorListener,
  type NotifyFn,
} from "@/modules/connectors/funnel-connector-listener"
import { logger } from "@/modules/logger"
import { FunnelProcessRunner } from "@/modules/process/funnel-process-runner"
import { NodeFunnelProcessRunner } from "@/modules/process/node-funnel-process-runner"
import type { GhConnectorConfig } from "@/modules/connectors/gh-connector-schema"

type GhNotification = {
  id: string
  reason: string
  subject: { type: string; url: string; title: string }
  repository: { full_name: string }
  updated_at: string
}

type Deps = {
  config: GhConnectorConfig
  process?: FunnelProcessRunner
}

const defaultProcess = new NodeFunnelProcessRunner()

const MAX_SEEN = 10000
const KEEP_SEEN = 5000

export class FunnelGhListener extends FunnelConnectorListener {
  private readonly config: GhConnectorConfig
  private readonly process: FunnelProcessRunner
  private readonly seen = new Map<string, string>()
  private bootstrapped = false
  private since = new Date().toISOString()

  constructor(deps: Deps) {
    super()
    this.config = deps.config
    this.process = deps.process ?? defaultProcess
  }

  async start(notify: NotifyFn): Promise<void> {
    await this.pollOnce(notify)

    const interval = this.config.pollInterval ?? 60

    setInterval(() => void this.pollOnce(notify), interval * 1000).unref()
  }

  async pollOnce(notify: NotifyFn): Promise<void> {
    const nextSince = new Date().toISOString()
    const params = new URLSearchParams({ since: this.since, all: "false" })

    try {
      const result = await this.process.run(["gh", "api", `/notifications?${params}`])

      if (result.exitCode !== 0) {
        logger.error("gh poll failed", { stderr: result.stderr })
        return
      }

      const items = JSON.parse(result.stdout) as GhNotification[]

      for (const item of items) {
        if (this.seen.get(item.id) === item.updated_at) continue

        this.seen.set(item.id, item.updated_at)

        if (!this.bootstrapped) continue

        const meta: Record<string, string> = {
          event_type: "gh",
          reason: item.reason,
          subject_type: item.subject.type,
          subject_url: item.subject.url,
          repository: item.repository.full_name,
          thread_id: item.id,
          updated_at: item.updated_at,
        }

        await notify(JSON.stringify(item), meta)
      }

      if (this.seen.size > MAX_SEEN) {
        const toDrop = this.seen.size - KEEP_SEEN
        let dropped = 0

        for (const key of this.seen.keys()) {
          if (dropped >= toDrop) break
          this.seen.delete(key)
          dropped++
        }
      }

      this.since = nextSince
      this.bootstrapped = true
    } catch (error) {
      logger.error("gh poll error", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
