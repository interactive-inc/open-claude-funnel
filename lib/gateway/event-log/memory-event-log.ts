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
 * lifetime but is lost when the process exits. Optional row and byte caps
 * bound retention without resetting the monotonic offset.
 */
export class MemoryFunnelEventLog extends FunnelEventLog {
  private readonly events: StoredEvent[] = []

  private latestOffset = 0
  private bytes = 0

  constructor(private readonly options: { maxRows?: number; maxBytes?: number } = {}) {
    super()
  }

  record(record: FunnelEventRecord): void {
    this.latestOffset = Math.max(this.latestOffset, record.offset)
    this.bytes += this.sizeOf(record.content, record.meta)
    this.events.push({
      offset: record.offset,
      content: record.content,
      meta: record.meta ?? undefined,
      channelId: record.channelId,
      connectorId: record.connectorId,
      ...(record.exclusive ? { exclusive: { ...record.exclusive } } : {}),
    })
    while (
      this.events.length > 0 &&
      (this.events.length > (this.options.maxRows ?? Infinity) ||
        this.bytes > (this.options.maxBytes ?? Infinity))
    ) {
      const removed = this.events.shift()
      if (removed) this.bytes -= this.sizeOf(removed.content, removed.meta)
    }
  }

  private sizeOf(content: string, meta: Record<string, string> | null | undefined): number {
    return Buffer.byteLength(content) + Buffer.byteLength(JSON.stringify(meta ?? {}))
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
    return this.latestOffset
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
    this.bytes = 0
  }

  close(): void {}
}
