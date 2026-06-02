import { openSync } from "node:fs"
import { parseCsvRow } from "@/engine/process/parse-csv-row"
import {
  type AttachOptions,
  type DetachOptions,
  FunnelProcessRunner,
  type ProcessSnapshot,
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

const isWindows = (): boolean => process.platform === "win32"

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

    if (options.onSpawned) {
      options.onSpawned(proc.pid)
    }

    return await proc.exited
  }

  detach(command: string[], options: DetachOptions = {}): void {
    const stdoutTarget = options.stdoutFile ? openSync(options.stdoutFile, "a") : "ignore"
    const stderrTarget = options.stderrFile
      ? options.stderrFile === options.stdoutFile && typeof stdoutTarget === "number"
        ? stdoutTarget
        : openSync(options.stderrFile, "a")
      : "ignore"

    const proc = Bun.spawn(command, {
      env: toEnv(options.env),
      stdio: ["ignore", stdoutTarget, stderrTarget],
      windowsHide: true,
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

  isAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false

    if (isWindows()) return this.isAliveWindows(pid)

    return this.isAlivePosix(pid)
  }

  listProcessesContaining(marker: string): ProcessSnapshot[] {
    if (!marker) return []

    if (isWindows()) return this.listProcessesContainingWindows(marker)

    return this.listProcessesContainingPosix(marker)
  }

  private isAlivePosix(pid: number): boolean {
    const result = this.runSync(["ps", "-p", String(pid), "-o", "state="])

    if (result.exitCode !== 0) return false

    const state = result.stdout.trim()

    if (!state) return false

    return !state.startsWith("Z")
  }

  private isAliveWindows(pid: number): boolean {
    const result = this.runSync(["tasklist", "/FI", `PID eq ${pid}`, "/NH", "/FO", "CSV"])

    if (result.exitCode !== 0) return false

    return result.stdout.includes(`"${pid}"`)
  }

  private listProcessesContainingPosix(marker: string): ProcessSnapshot[] {
    const result = this.runSync(["ps", "-e", "-o", "pid=,args="])

    if (result.exitCode !== 0) return []

    const snapshots: ProcessSnapshot[] = []

    for (const raw of result.stdout.split("\n")) {
      const line = raw.trim()

      if (!line) continue

      const match = /^(\d+)\s+(.+)$/.exec(line)

      if (!match) continue

      const pid = Number(match[1])
      const command = match[2] ?? ""

      if (!Number.isInteger(pid) || pid <= 0) continue
      if (!command.includes(marker)) continue

      snapshots.push({ pid, command })
    }

    return snapshots
  }

  private listProcessesContainingWindows(marker: string): ProcessSnapshot[] {
    // PowerShell's CIM provider is the only built-in path that reliably
    // exposes full CommandLine (tasklist only shows the image name).
    const script =
      "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Csv -NoTypeInformation"
    const result = this.runSync(["powershell", "-NoProfile", "-Command", script])

    if (result.exitCode !== 0) return []

    const snapshots: ProcessSnapshot[] = []
    const lines = result.stdout.split(/\r?\n/).slice(1)

    for (const raw of lines) {
      const line = raw.trim()

      if (!line) continue

      const cells = parseCsvRow(line)

      if (cells.length < 2) continue

      const pid = Number(cells[0])
      const command = cells[1] ?? ""

      if (!Number.isInteger(pid) || pid <= 0) continue
      if (!command.includes(marker)) continue

      snapshots.push({ pid, command })
    }

    return snapshots
  }
}
