import type { ReplayableEvent } from "@/gateway/broadcaster"
import { FunnelEventLog, type FunnelEventRecord } from "@/gateway/event-log/event-log"

type StoredEvent = {
  offset: number
  content: string
  meta: Record<string, string> | undefined
  channelId: string | null
  connectorId: string | null
  exclusive?: Record<string, string | null>
}

/**
 * In-process `FunnelEventLog` backed by a plain array. Used by tests and by
 * embedders that do not need durability — replay works within the process
 * lifetime but is lost when the process exits. It does not prune,
 * so it is not meant for unbounded production
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
      ...(record.exclusive ? { exclusive: { ...record.exclusive } } : {}),
    })
  }

  loadSince(since: number): ReplayableEvent[] {
    const out: ReplayableEvent[] = []

    for (const event of this.events) {
      if (event.offset > since) {
        out.push({
          content: event.content,
          meta: event.meta,
          offset: event.offset,
          ...(event.exclusive ? { exclusive: { ...event.exclusive } } : {}),
        })
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

  override claimExclusive(offset: number, channelId: string, subscriberId: string): boolean {
    const event = this.events.find((candidate) => candidate.offset === offset)
    const exclusive = event?.exclusive

    if (!exclusive || exclusive[channelId] === undefined) return false
    if (exclusive[channelId] !== null) return exclusive[channelId] === subscriberId

    exclusive[channelId] = subscriberId
    return true
  }

  clear(): void {
    this.events.length = 0
  }

  close(): void {}
}
