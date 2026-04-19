export type RunOptions = {
  cwd?: string
  env?: Record<string, string>
  input?: string
}

export type RunResult = {
  exitCode: number
  stdout: string
  stderr: string
}

export type AttachOptions = {
  cwd?: string
  env?: Record<string, string>
}

export type DetachOptions = {
  env?: Record<string, string>
}

export abstract class FunnelProcessRunner {
  abstract run(command: string[], options?: RunOptions): Promise<RunResult>
  abstract runSync(command: string[]): RunResult
  abstract attach(command: string[], options?: AttachOptions): Promise<number>
  abstract detach(command: string[], options?: DetachOptions): void
  abstract kill(pid: number, signal?: string): void
}
