import { join } from "node:path"
import type { ProcessGuard } from "@/engine/claude/process-guard"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FUNNEL_DIR } from "@/engine/settings/settings-store"

type Deps = {
  fs?: FunnelFileSystem
  process?: FunnelProcessRunner
  dir?: string
}

type PidRecord = {
  pid: number
  startTime: string | null
}

const defaultFs = new NodeFunnelFileSystem()
const defaultProcess = new NodeFunnelProcessRunner()

export class FileProcessGuard implements ProcessGuard {
  private readonly fs: FunnelFileSystem
  private readonly process: FunnelProcessRunner
  private readonly pidDir: string

  constructor(deps: Deps = {}) {
    this.fs = deps.fs ?? defaultFs
    this.process = deps.process ?? defaultProcess
    this.pidDir = join(deps.dir ?? FUNNEL_DIR, "claude")
    Object.freeze(this)
  }

  isRunning(profileId: string): boolean {
    const record = this.readRecord(profileId)

    if (!record) return false

    if (!this.process.isAlive(record.pid)) {
      // PID died without firing the exit hook (SIGKILL, crash, power loss).
      // Self-heal so the next acquire() can claim the profile.
      this.release(profileId)

      return false
    }

    // Verify the PID still belongs to the same process by comparing start time.
    // Catches PID reuse: another unrelated process may have inherited the PID
    // after the original died. Backwards-compat: pre-startTime PID files have
    // startTime=null and skip the check (one-shot migration on next acquire).
    if (record.startTime !== null) {
      const currentStartTime = this.process.getStartTime(record.pid)

      if (currentStartTime === null) {
        this.release(profileId)

        return false
      }

      if (currentStartTime !== record.startTime) {
        this.release(profileId)

        return false
      }
    }

    return true
  }

  acquire(profileId: string): void {
    this.fs.mkdirSync(this.pidDir, { recursive: true })

    const pid = globalThis.process.pid
    const startTime = this.process.getStartTime(pid)
    const record: PidRecord = { pid, startTime }

    this.fs.writeFileSync(this.pidPath(profileId), JSON.stringify(record))

    // Default Bun behavior on SIGINT/SIGTERM is process.exit(130/143), which
    // fires the "exit" event. Hooking only "exit" keeps the PID file cleanup
    // running while letting the signal terminate the process normally.
    globalThis.process.once("exit", () => this.release(profileId))
  }

  release(profileId: string): void {
    const path = this.pidPath(profileId)

    if (this.fs.existsSync(path)) this.fs.unlink(path)
  }

  private pidPath(profileId: string): string {
    return join(this.pidDir, `${profileId}.pid`)
  }

  private readRecord(profileId: string): PidRecord | null {
    const path = this.pidPath(profileId)

    if (!this.fs.existsSync(path)) return null

    try {
      const content = this.fs.readFileSync(path).trim()

      if (!content) return null

      // New format: JSON {pid, startTime}. Old format: bare number.
      if (content.startsWith("{")) {
        const parsed = JSON.parse(content) as { pid?: unknown; startTime?: unknown }
        const pid = typeof parsed.pid === "number" ? parsed.pid : Number(parsed.pid)

        if (!Number.isInteger(pid) || pid <= 0) return null

        const startTime = typeof parsed.startTime === "string" ? parsed.startTime : null

        return { pid, startTime }
      }

      const pid = Number(content)

      if (!pid || pid <= 0) return null

      return { pid, startTime: null }
    } catch {
      return null
    }
  }
}
