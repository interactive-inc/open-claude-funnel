import {
  type AttachOptions,
  type DetachOptions,
  FunnelProcessRunner,
  type RunOptions,
  type RunResult,
} from "@/modules/process/funnel-process-runner"

export type MemoryProcessResponse = {
  exitCode?: number
  stdout?: string
  stderr?: string
}

export type MemoryProcessHandler = (
  command: string[],
) => MemoryProcessResponse | Promise<MemoryProcessResponse>

export type MemoryProcessSyncHandler = (command: string[]) => MemoryProcessResponse

export type MemoryProcessCall = {
  kind: "run" | "runSync" | "attach" | "detach" | "kill"
  command: string[]
  options?: RunOptions | AttachOptions | DetachOptions
}

const empty: MemoryProcessResponse = { exitCode: 0, stdout: "", stderr: "" }

export class MemoryFunnelProcessRunner extends FunnelProcessRunner {
  readonly calls: MemoryProcessCall[] = []
  readonly killed: { pid: number; signal: string }[] = []
  private handler: MemoryProcessHandler = () => empty
  private syncHandler: MemoryProcessSyncHandler = () => empty

  on(handler: MemoryProcessHandler): this {
    this.handler = handler

    return this
  }

  onSync(handler: MemoryProcessSyncHandler): this {
    this.syncHandler = handler

    return this
  }

  async run(command: string[], options: RunOptions = {}): Promise<RunResult> {
    this.calls.push({ kind: "run", command, options })

    const result = await this.handler(command)

    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    }
  }

  runSync(command: string[]): RunResult {
    this.calls.push({ kind: "runSync", command })

    const result = this.syncHandler(command)

    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    }
  }

  async attach(command: string[], options: AttachOptions = {}): Promise<number> {
    this.calls.push({ kind: "attach", command, options })

    const result = await this.handler(command)

    return result.exitCode ?? 0
  }

  detach(command: string[], options: DetachOptions = {}): void {
    this.calls.push({ kind: "detach", command, options })
  }

  kill(pid: number, signal: string = "SIGTERM"): void {
    this.calls.push({ kind: "kill", command: [String(pid), signal] })
    this.killed.push({ pid, signal })
  }
}
