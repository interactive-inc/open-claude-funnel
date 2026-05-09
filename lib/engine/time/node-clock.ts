import { FunnelClock } from "@/engine/time/clock"

export class NodeFunnelClock extends FunnelClock {
  now(): Date {
    return new Date()
  }
}
