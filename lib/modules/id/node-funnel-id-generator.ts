import { FunnelIdGenerator } from "@/modules/id/funnel-id-generator"

export class NodeFunnelIdGenerator extends FunnelIdGenerator {
  generate(): string {
    return crypto.randomUUID()
  }
}
