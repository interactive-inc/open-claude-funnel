import { FunnelClock } from "@/engine/time/clock"

type Props = {
  start?: Date
}

export class MemoryFunnelClock extends FunnelClock {
  private current: Date

  constructor(props: Props = {}) {
    super()
    this.current = new Date(props.start?.getTime() ?? 0)
  }

  now(): Date {
    return new Date(this.current.getTime())
  }

  set(date: Date): void {
    this.current = new Date(date.getTime())
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}
