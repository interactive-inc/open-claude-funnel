import { FunnelIdGenerator } from "@/engine/id/id-generator"

type Props = {
  prefix?: string
}

export class MemoryFunnelIdGenerator extends FunnelIdGenerator {
  private counter = 0
  private readonly prefix: string

  constructor(props: Props = {}) {
    super()
    this.prefix = props.prefix ?? "id"
  }

  generate(): string {
    this.counter++
    return `${this.prefix}-${this.counter}`
  }
}
