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
  /** Append stdout to this file. Parent dir is the caller's responsibility. */
  stdoutFile?: string
  /** Append stderr to this file. Parent dir is the caller's responsibility. */
  stderrFile?: string
}

export type ProcessSnapshot = {
  pid: number
  command: string
}

/**
 * Process boundary covering one-shot runs, sync runs, foreground attach, and
 * detached background spawns. Default is NodeFunnelProcessRunner (Bun.spawn);
 * MemoryFunnelProcessRunner records calls and lets tests stub responses.
 *
 * Liveness and process-listing helpers absorb POSIX/Windows differences so
 * callers do not branch on `process.platform`. `isAlive` checks whether a PID
 * names a live (non-zombie) process; `listProcessesContaining` enumerates
 * processes whose command line includes `marker`, used for funnel-gateway tag
 * matching across daemons that share a home dir.
 */
export abstract class FunnelProcessRunner {
  abstract run(command: string[], options?: RunOptions): Promise<RunResult>
  abstract runSync(command: string[]): RunResult
  abstract attach(command: string[], options?: AttachOptions): Promise<number>
  abstract detach(command: string[], options?: DetachOptions): void
  abstract kill(pid: number, signal?: string): void
  abstract isAlive(pid: number): boolean
  abstract listProcessesContaining(marker: string): ProcessSnapshot[]
}
