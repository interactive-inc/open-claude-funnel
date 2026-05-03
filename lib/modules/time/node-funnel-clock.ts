import { FunnelClock } from "@/modules/time/funnel-clock"

export class NodeFunnelClock extends FunnelClock {
  now(): Date {
    return new Date()
  }
}
