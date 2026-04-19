import {
  FunnelConnectorAdapter,
  type CallInput,
} from "@/modules/connectors/funnel-connector-adapter"
import { FunnelProcessRunner } from "@/modules/process/funnel-process-runner"
import { NodeFunnelProcessRunner } from "@/modules/process/node-funnel-process-runner"

type Deps = {
  process?: FunnelProcessRunner
}

const defaultProcess = new NodeFunnelProcessRunner()

export class FunnelGhAdapter extends FunnelConnectorAdapter {
  private readonly process: FunnelProcessRunner

  constructor(deps: Deps = {}) {
    super()
    this.process = deps.process ?? defaultProcess
    Object.freeze(this)
  }

  async call(input: CallInput): Promise<unknown> {
    const args = ["api", input.path]

    if (input.method && input.method.toLowerCase() !== "get") {
      args.push("-X", input.method.toUpperCase())
    }

    const hasBody =
      input.body && typeof input.body === "object" && Object.keys(input.body).length > 0

    if (hasBody) {
      args.push("--input", "-")
    }

    const result = await this.process.run(["gh", ...args], {
      input: hasBody ? JSON.stringify(input.body) : undefined,
    })

    if (result.exitCode !== 0) {
      throw new Error(`gh api failed: ${result.stderr.trim() || result.stdout.trim()}`)
    }

    try {
      return JSON.parse(result.stdout)
    } catch {
      return result.stdout
    }
  }
}
