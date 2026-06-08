import type { FunnelLogEntry } from "@/logger/funnel-log-entry"
import type { FunnelLogPrimarySink, FunnelLogSink } from "@/logger/funnel-log-sink"

type Listener<E> = (record: FunnelLogEntry<E>) => void

type SinkErrorHandler<E> = (
  error: Error,
  record: FunnelLogEntry<E>,
  sink: FunnelLogSink<E>,
) => void

export type FunnelLogValidator<E> = (
  event: unknown,
) => { success: true; data: E } | { success: false; error: Error }

type Props<E> = {
  /** Validates each event before emission. Use `schema.safeParse` from any validation library, or a plain function. */
  validate: FunnelLogValidator<E>
  /** Owns seq assignment + durability. Use `FunnelLogSqliteSink` for multi-process safety. */
  primary: FunnelLogPrimarySink<E>
  /** Optional fanout for already-sequenced records (memory ring, stdout, network mirror). */
  relays?: ReadonlyArray<FunnelLogSink<E>>
  /** Override for tests. Defaults to `Date.now`. */
  now?: () => number
  /** Observer for relay failures. Default: silently swallow. */
  onSinkError?: SinkErrorHandler<E>
}

/**
 * Validated event log bus. Three responsibilities and nothing else:
 * validate the event, delegate seq + persistence to the primary sink, and
 * fan the resulting record out to relays and live subscribers.
 *
 * Splitting "primary" from "relays" makes the seq invariant honest: there
 * is exactly one source of truth (the primary's atomic insert). Two
 * `FunnelLog` instances pointed at the same SQLite file therefore see
 * one monotonic stream without bus-level coordination. Relays mirror
 * already-sequenced records, so they can be added or removed without
 * affecting correctness.
 *
 * Failure isolation:
 *   - Primary failure short-circuits emit and is returned to the caller.
 *   - Relay failures never block the primary path — they surface via the
 *     optional `onSinkError` callback so the caller can observe without
 *     being interrupted.
 *   - A subscriber that throws is contained; the rest of the fanout
 *     completes normally.
 */
export class FunnelLog<E> {
  private readonly validate: FunnelLogValidator<E>
  private readonly primary: FunnelLogPrimarySink<E>
  private readonly relays: ReadonlyArray<FunnelLogSink<E>>
  private readonly now: () => number
  private readonly onSinkError: SinkErrorHandler<E> | null
  private readonly listeners = new Set<Listener<E>>()

  constructor(props: Props<E>) {
    this.validate = props.validate
    this.primary = props.primary
    this.relays = props.relays ?? []
    this.now = props.now ?? (() => Date.now())
    this.onSinkError = props.onSinkError ?? null
  }

  emit(event: E): FunnelLogEntry<E> | Error {
    const parsed = this.validate(event)
    if (!parsed.success) return parsed.error

    const result = this.callPrimary(parsed.data)
    if (result instanceof Error) return result

    this.fanOutToRelays(result)
    this.fanOutToListeners(result)

    return result
  }

  subscribe(listener: Listener<E>): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getMaxSeq(): number {
    return this.primary.getMaxSeq()
  }

  close(): void {
    this.listeners.clear()
    this.callClose(this.primary)
    for (const relay of this.relays) this.callClose(relay)
  }

  private callPrimary(event: E): FunnelLogEntry<E> | Error {
    try {
      return this.primary.insert({ ts: this.now(), event })
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e))
    }
  }

  private fanOutToRelays(record: FunnelLogEntry<E>): void {
    for (const relay of this.relays) {
      const error = this.callRelay(relay, record)
      if (!error) continue
      if (this.onSinkError) this.onSinkError(error, record, relay)
    }
  }

  private callRelay(relay: FunnelLogSink<E>, record: FunnelLogEntry<E>): Error | null {
    try {
      const outcome = relay.write(record)
      return outcome instanceof Error ? outcome : null
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e))
    }
  }

  private fanOutToListeners(record: FunnelLogEntry<E>): void {
    for (const listener of this.listeners) {
      try {
        listener(record)
      } catch {
        // a faulty subscriber must not derail emission for everyone else
      }
    }
  }

  private callClose(sink: { close?(): void }): void {
    if (!sink.close) return
    try {
      sink.close()
    } catch {
      // close failures are best-effort by definition
    }
  }
}
