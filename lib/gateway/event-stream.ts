import type { ReplayableEvent } from "@/gateway/broadcaster"

export type FunnelEventSubscription = AsyncIterableIterator<ReplayableEvent> & {
  return(): Promise<IteratorResult<ReplayableEvent>>
}

export type EventStreamOptions = {
  signal?: AbortSignal
  /** Queued events, excluding events already handed to the consumer. Default: 200. */
  maxQueuedEvents?: number
  /** Serialized queued bytes. Default: 4 MiB. Overflow rejects the stream. */
  maxQueuedBytes?: number
}

type PendingRead = {
  resolve: (value: IteratorResult<ReplayableEvent>) => void
  reject: (error: Error) => void
}

/** A bounded subscription. Created eagerly so startup events are not lost before the first read. */
export class FunnelEventStream implements AsyncIterableIterator<ReplayableEvent> {
  private readonly queue: { event: ReplayableEvent; bytes: number }[] = []
  private readonly pending: PendingRead[] = []
  private readonly maxQueuedEvents: number
  private readonly maxQueuedBytes: number
  private readonly onAbort = () => this.close()
  private bytes = 0
  private closed = false
  private failure: Error | undefined

  constructor(
    private readonly options: EventStreamOptions,
    private readonly onClose: () => void,
  ) {
    this.maxQueuedEvents = options.maxQueuedEvents ?? 200
    this.maxQueuedBytes = options.maxQueuedBytes ?? 4 * 1024 * 1024
    if (!Number.isSafeInteger(this.maxQueuedEvents) || this.maxQueuedEvents < 1)
      throw new Error("maxQueuedEvents must be a positive safe integer")
    if (!Number.isSafeInteger(this.maxQueuedBytes) || this.maxQueuedBytes < 1)
      throw new Error("maxQueuedBytes must be a positive safe integer")
    if (options.signal?.aborted) this.close()
    else options.signal?.addEventListener("abort", this.onAbort, { once: true })
  }

  get isClosed(): boolean {
    return this.closed
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<ReplayableEvent> {
    return this
  }

  next(): Promise<IteratorResult<ReplayableEvent>> {
    if (this.failure) return Promise.reject(this.failure)
    const queued = this.queue.shift()
    if (queued) {
      this.bytes -= queued.bytes
      return Promise.resolve({ value: queued.event, done: false })
    }
    if (this.closed) return Promise.resolve({ value: undefined, done: true })
    return new Promise((resolve, reject) => this.pending.push({ resolve, reject }))
  }

  return(): Promise<IteratorResult<ReplayableEvent>> {
    this.close()
    return Promise.resolve({ value: undefined, done: true })
  }

  push(event: ReplayableEvent): void {
    if (this.closed) return
    const waiting = this.pending.shift()
    if (waiting) {
      waiting.resolve({ value: event, done: false })
      return
    }
    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength
    if (this.queue.length >= this.maxQueuedEvents || this.bytes + bytes > this.maxQueuedBytes) {
      this.close(new Error("Funnel event stream overflow; resume from the last handled offset"))
      return
    }
    this.queue.push({ event, bytes })
    this.bytes += bytes
  }

  /** Cancellation discards queued inputs; SDK/session and MCP/server ownership stays with the host. */
  close(error?: Error): void {
    if (this.closed) return
    this.closed = true
    this.failure = error
    this.options.signal?.removeEventListener("abort", this.onAbort)
    this.queue.length = 0
    this.bytes = 0
    this.onClose()
    for (const waiting of this.pending.splice(0)) {
      if (error) waiting.reject(error)
      else waiting.resolve({ value: undefined, done: true })
    }
  }
}
