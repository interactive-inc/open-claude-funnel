import {
  type AttachOptions,
  type DetachOptions,
  FunnelProcessRunner,
  type RunOptions,
  type RunResult,
} from "@/engine/process/process-runner"

const toEnv = (env?: Record<string, string>): Record<string, string> | undefined => {
  if (!env) return undefined

  const merged: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") merged[key] = value
  }

  for (const [key, value] of Object.entries(env)) {
    merged[key] = value
  }

  return merged
}

export class NodeFunnelProcessRunner extends FunnelProcessRunner {
  constructor() {
    super()
    Object.freeze(this)
  }

  runSync(command: string[]): RunResult {
    const result = Bun.spawnSync(command, {
      stdout: "pipe",
      stderr: "pipe",
    })

    return {
      exitCode: result.exitCode ?? 0,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    }
  }

  async run(command: string[], options: RunOptions = {}): Promise<RunResult> {
    const proc = Bun.spawn(command, {
      cwd: options.cwd,
      env: toEnv(options.env),
      stdin: options.input !== undefined ? "pipe" : "ignore",
      stdout: "pipe",
      stderr: "pipe",
    })

    if (options.input !== undefined && proc.stdin) {
      proc.stdin.write(options.input)
      proc.stdin.end()
    }

    const exitCode = await proc.exited
    const stdout = await new Response(proc.stdout).text()
    const stderr = await new Response(proc.stderr).text()

    return { exitCode, stdout, stderr }
  }

  async attach(command: string[], options: AttachOptions = {}): Promise<number> {
    const proc = Bun.spawn(command, {
      cwd: options.cwd,
      env: toEnv(options.env),
      stdio: ["inherit", "inherit", "inherit"],
    })

    return await proc.exited
  }

  detach(command: string[], options: DetachOptions = {}): void {
    const proc = Bun.spawn(command, {
      env: toEnv(options.env),
      stdio: ["ignore", "ignore", "ignore"],
    })

    proc.unref()
  }

  kill(pid: number, signal: string = "SIGTERM"): void {
    try {
      process.kill(pid, signal)
    } catch {
      // ignore
    }
  }
}
