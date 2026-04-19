import {
  type AttachOptions,
  type DetachOptions,
  FunnelProcessRunner,
  type RunOptions,
  type RunResult,
} from "@/modules/process/funnel-process-runner"

const toEnv = (env?: Record<string, string>): Record<string, string> | undefined => {
  if (!env) return undefined

  return { ...(process.env as Record<string, string>), ...env }
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

    const forward = (signal: "SIGINT" | "SIGTERM") => {
      try {
        proc.kill(signal)
      } catch {
        // ignore
      }

      setTimeout(() => {
        try {
          proc.kill("SIGKILL")
        } catch {
          // ignore
        }
      }, 3000).unref()
    }

    process.on("SIGINT", () => forward("SIGINT"))
    process.on("SIGTERM", () => forward("SIGTERM"))

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
