import { FunnelClock } from "@/engine/time/clock"

type Props = {
  start?: Date
}

export class MemoryFunnelClock extends FunnelClock {
  private current: Date

  constructor(props: Props = {}) {
    super()
    this.current = props.start ?? new Date(0)
  }

  now(): Date {
    return new Date(this.current.getTime())
  }

  set(date: Date): void {
    this.current = date
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms)
  }
}
