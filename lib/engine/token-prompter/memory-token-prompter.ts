import { FunnelTokenPrompter } from "@/engine/token-prompter/token-prompter"

type Props = {
  answers?: Record<string, string>
}

/**
 * Pre-seeded answers keyed by prompt label. Tests configure the map up front;
 * unmapped labels throw so the test surfaces unexpected prompts loudly.
 */
export class MemoryFunnelTokenPrompter extends FunnelTokenPrompter {
  private readonly answers: Map<string, string>

  readonly asked: string[] = []

  constructor(props: Props = {}) {
    super()
    this.answers = new Map(Object.entries(props.answers ?? {}))
  }

  async promptSecret(label: string): Promise<string> {
    this.asked.push(label)

    const answer = this.answers.get(label)

    if (answer === undefined) {
      throw new Error(`no answer seeded for prompt "${label}"`)
    }

    return answer
  }
}
