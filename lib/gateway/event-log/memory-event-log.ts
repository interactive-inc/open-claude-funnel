import { requireIntegerLimit } from "@/require-limit"
import type { ReplayableEvent } from "@/gateway/broadcaster"
import { FunnelEventLog, type FunnelEventRecord } from "@/gateway/event-log/event-log"
import { eventSnapshot } from "@/gateway/event-snapshot"
import { replayRoutingMetadata } from "@/gateway/event-log/replay-routing"

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

  private readonly maxRows: number
  private readonly maxBytes: number

  constructor(options: { maxRows?: number; maxBytes?: number } = {}) {
    super()
    this.maxRows =
      options.maxRows === undefined ? Infinity : requireIntegerLimit(options.maxRows, "maxRows")
    this.maxBytes =
      options.maxBytes === undefined ? Infinity : requireIntegerLimit(options.maxBytes, "maxBytes")
  }

  record(record: FunnelEventRecord): void {
    const offset = record.offset
    if (!Number.isSafeInteger(offset) || offset < 1)
      throw new RangeError("event offset must be a positive safe integer")
    const channelId = record.channelId
    const connectorId = record.connectorId
    const meta = replayRoutingMetadata(channelId, connectorId, record.meta)
    const exclusive = record.exclusive
    const event: StoredEvent = {
      offset,
      content: record.content,
      meta,
      channelId,
      connectorId,
      ...(exclusive ? { exclusive: { ...exclusive } } : {}),
    }
    const bytes = this.sizeOf(event.content, event.meta)
    const index =
      offset <= this.latestOffset ? this.events.findIndex((stored) => stored.offset >= offset) : -1
    if (index >= 0 && this.events[index]?.offset === offset)
      throw new Error("event offset is already recorded")

    this.events.splice(index < 0 ? this.events.length : index, 0, event)
    this.latestOffset = Math.max(this.latestOffset, offset)
    this.bytes += bytes
    while (
      this.events.length > 0 &&
      (this.events.length > this.maxRows || this.bytes > this.maxBytes)
    ) {
      const removed = this.events.shift()
      if (removed) this.bytes -= this.sizeOf(removed.content, removed.meta)
    }
  }

  private sizeOf(content: string, meta: Record<string, string> | null | undefined): number {
    return Buffer.byteLength(content) + Buffer.byteLength(JSON.stringify(meta ?? {}))
  }

  loadSince(since: number, limit = Infinity): ReplayableEvent[] {
    const out: ReplayableEvent[] = []

    for (const event of this.events) {
      if (event.offset > since) {
        if (out.length >= limit) break
        out.push(
          eventSnapshot({
            content: event.content,
            meta: event.meta,
            offset: event.offset,
            ...(event.exclusive ? { exclusive: { ...event.exclusive } } : {}),
          }),
        )
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
