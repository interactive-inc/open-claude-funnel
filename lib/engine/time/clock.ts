import { requireSynchronous } from "@/require-synchronous"

/**
 * Time boundary. Default NodeFunnelClock returns `new Date()`; MemoryFunnelClock
 * is settable and `advance(ms)`-able for deterministic schedule / timeout tests.
 */
export abstract class FunnelClock {
  /** Return the current date synchronously or throw. */
  abstract now(): Date

  millis(): number {
    return requireSynchronous(this.now(), "clock now must be synchronous").getTime()
  }

  iso(): string {
    return requireSynchronous(this.now(), "clock now must be synchronous").toISOString()
  }
}
