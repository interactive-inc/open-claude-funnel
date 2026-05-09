/**
 * Time boundary. Default NodeFunnelClock returns `new Date()`; MemoryFunnelClock
 * is settable and `advance(ms)`-able for deterministic schedule / timeout tests.
 */
export abstract class FunnelClock {
  abstract now(): Date

  millis(): number {
    return this.now().getTime()
  }

  iso(): string {
    return this.now().toISOString()
  }
}
