import { FunnelIdGenerator } from "@/engine/id/id-generator"

export class NodeFunnelIdGenerator extends FunnelIdGenerator {
  generate(): string {
    return crypto.randomUUID()
  }
}
