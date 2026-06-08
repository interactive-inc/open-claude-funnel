import type { FunnelLogEntry } from "@/logger/funnel-log-entry"
import type { FunnelLogPrimarySink, FunnelLogSink } from "@/logger/funnel-log-sink"

type Props = {
  /** Hard cap on retained records. The oldest is evicted on overflow. 0 disables retention. */
  capacity?: number
}

/**
 * In-memory ring buffer that doubles as primary or relay. As primary it
 * owns its own seq counter (single-process only — for multi-process
 * safety, use `FunnelLogSqliteSink` as primary and place this as a
 * relay). As relay it accepts whatever seq the primary assigned and
 * advances its own counter to match, so `getMaxSeq` stays meaningful.
 *
 * Useful as a test double, as a short-window replay buffer paired with a
 * persistent primary (covering reconnects without round-tripping disk),
 * or as a backing store for live subscribers.
 */
export class FunnelLogMemorySink<E> implements FunnelLogPrimarySink<E>, FunnelLogSink<E> {
  private readonly capacity: number
  private readonly buffer: FunnelLogEntry<E>[] = []
  private seq = 0

  constructor(props: Props = {}) {
    this.capacity = Math.max(0, props.capacity ?? 1000)
  }

  insert(input: { ts: number; event: E }): FunnelLogEntry<E> {
    this.seq += 1
    const record: FunnelLogEntry<E> = {
      seq: this.seq,
      ts: input.ts,
      event: input.event,
    }
    this.append(record)
    return record
  }

  write(record: FunnelLogEntry<E>): void {
    if (record.seq > this.seq) this.seq = record.seq
    this.append(record)
  }

  getMaxSeq(): number {
    return this.seq
  }

  query(): ReadonlyArray<FunnelLogEntry<E>> {
    return this.buffer
  }

  clear(): void {
    this.buffer.length = 0
    this.seq = 0
  }

  private append(record: FunnelLogEntry<E>): void {
    if (this.capacity === 0) return

    this.buffer.push(record)

    if (this.buffer.length > this.capacity) {
      this.buffer.shift()
    }
  }
}
