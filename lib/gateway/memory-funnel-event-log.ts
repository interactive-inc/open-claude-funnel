import type { ReplayableEvent } from "@/gateway/broadcaster"
import { FunnelEventLog, type FunnelEventRecord } from "@/gateway/funnel-event-log"

type StoredEvent = {
  offset: number
  content: string
  meta: Record<string, string> | undefined
  channelId: string | null
  connectorId: string | null
}

/**
 * In-process `FunnelEventLog` backed by a plain array. Used by tests and by
 * embedders that do not need durability — replay works within the process
 * lifetime but is lost when the process exits. Unlike the SQLite log it does
 * not truncate content or prune, so it is not meant for unbounded production
 * traffic.
 */
export class MemoryFunnelEventLog extends FunnelEventLog {
  private readonly events: StoredEvent[] = []

  constructor() {
    super()
    Object.freeze(this)
  }

  record(record: FunnelEventRecord): void {
    this.events.push({
      offset: record.offset,
      content: record.content,
      meta: record.meta ?? undefined,
      channelId: record.channelId,
      connectorId: record.connectorId,
    })
  }

  loadSince(since: number): ReplayableEvent[] {
    const out: ReplayableEvent[] = []

    for (const event of this.events) {
      if (event.offset > since) {
        out.push({ content: event.content, meta: event.meta, offset: event.offset })
      }
    }

    return out
  }

  findMaxOffset(): number {
    let max = 0

    for (const event of this.events) {
      if (event.offset > max) max = event.offset
    }

    return max
  }

  close(): void {}
}
