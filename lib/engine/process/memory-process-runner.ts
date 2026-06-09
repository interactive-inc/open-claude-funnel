import {
  type AttachOptions,
  type DetachOptions,
  FunnelProcessRunner,
  type ProcessSnapshot,
  type RunOptions,
  type RunResult,
} from "@/engine/process/process-runner"

export type MemoryProcessResponse = {
  exitCode?: number
  stdout?: string
  stderr?: string
}

export type MemoryProcessHandler = (
  command: string[],
) => MemoryProcessResponse | Promise<MemoryProcessResponse>

export type MemoryProcessSyncHandler = (command: string[]) => MemoryProcessResponse

export type MemoryProcessCall =
  | { kind: "run"; command: string[]; options: RunOptions }
  | { kind: "runSync"; command: string[] }
  | { kind: "attach"; command: string[]; options: AttachOptions }
  | { kind: "detach"; command: string[]; options: DetachOptions }
  | { kind: "kill"; command: string[] }

const empty: MemoryProcessResponse = { exitCode: 0, stdout: "", stderr: "" }

export type AliveStub = (pid: number) => boolean

export type ProcessListStub = (marker: string) => ProcessSnapshot[]

export type StartTimeStub = (pid: number) => string | null

export class MemoryFunnelProcessRunner extends FunnelProcessRunner {
  readonly calls: MemoryProcessCall[] = []
  readonly killed: { pid: number; signal: string }[] = []
  private handler: MemoryProcessHandler = () => empty
  private syncHandler: MemoryProcessSyncHandler = () => empty
  private aliveStub: AliveStub | null = null
  private listStub: ProcessListStub | null = null
  private startTimeStub: StartTimeStub | null = null

  on(handler: MemoryProcessHandler): this {
    this.handler = handler

    return this
  }

  onSync(handler: MemoryProcessSyncHandler): this {
    this.syncHandler = handler

    return this
  }

  onIsAlive(stub: AliveStub): this {
    this.aliveStub = stub

    return this
  }

  onListProcessesContaining(stub: ProcessListStub): this {
    this.listStub = stub

    return this
  }

  onGetStartTime(stub: StartTimeStub): this {
    this.startTimeStub = stub

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

    if (options.onSpawned) {
      options.onSpawned(1)
    }

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

  isAlive(pid: number): boolean {
    if (this.aliveStub) return this.aliveStub(pid)

    // Fallback: replay syncHandler against a "ps -p" probe so existing tests
    // that stubbed onSync continue to work without rewiring.
    const result = this.syncHandler(["ps", "-p", String(pid), "-o", "state="])
    if ((result.exitCode ?? 0) !== 0) return false

    const state = (result.stdout ?? "").trim()
    if (!state) return false

    return !state.startsWith("Z")
  }

  listProcessesContaining(marker: string): ProcessSnapshot[] {
    if (this.listStub) return this.listStub(marker)

    return []
  }

  getStartTime(pid: number): string | null {
    if (this.startTimeStub) return this.startTimeStub(pid)

    return null
  }
}
