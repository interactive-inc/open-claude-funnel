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
  /** Invoked synchronously after the child process has been spawned, with its PID.
   *  Useful for hosts that need to register the spawned process before it exits. */
  onSpawned?: (pid: number) => void
}

export type DetachOptions = {
  env?: Record<string, string>
}

/**
 * Process boundary covering one-shot runs, sync runs, foreground attach, and
 * detached background spawns. Default is NodeFunnelProcessRunner (Bun.spawn);
 * MemoryFunnelProcessRunner records calls and lets tests stub responses.
 */
export abstract class FunnelProcessRunner {
  abstract run(command: string[], options?: RunOptions): Promise<RunResult>
  abstract runSync(command: string[]): RunResult
  abstract attach(command: string[], options?: AttachOptions): Promise<number>
  abstract detach(command: string[], options?: DetachOptions): void
  abstract kill(pid: number, signal?: string): void
}
