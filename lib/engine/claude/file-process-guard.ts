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
    const pid = this.readPid(profileId)

    if (!pid) return false

    return this.process.isAlive(pid)
  }

  acquire(profileId: string): void {
    this.fs.mkdirSync(this.pidDir, { recursive: true })
    this.fs.writeFileSync(this.pidPath(profileId), String(globalThis.process.pid))

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

  private readPid(profileId: string): number | null {
    const path = this.pidPath(profileId)

    if (!this.fs.existsSync(path)) return null

    try {
      const content = this.fs.readFileSync(path).trim()
      const pid = Number(content)

      if (!pid || pid <= 0) return null

      return pid
    } catch {
      return null
    }
  }
}
