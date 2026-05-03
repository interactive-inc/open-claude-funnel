export abstract class FunnelClock {
  abstract now(): Date

  millis(): number {
    return this.now().getTime()
  }

  iso(): string {
    return this.now().toISOString()
  }
}
