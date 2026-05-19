import { join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { resolveDaemonScript } from "@/gateway/resolve-daemon-script"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FunnelProcessRunner } from "@/engine/process/process-runner"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FUNNEL_DIR } from "@/engine/settings/settings-store"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import { FunnelClock } from "@/engine/time/clock"
import { NodeFunnelClock } from "@/engine/time/node-clock"

const DEFAULT_PORT = 9742
const STARTUP_TIMEOUT_MS = 5000
const SIGTERM_TIMEOUT_MS = 2000
const POLL_INTERVAL_MS = 100
const SIGKILL_GRACE_MS = 200

type Deps = {
  process?: FunnelProcessRunner
  fs?: FunnelFileSystem
  clock?: FunnelClock
  dir?: string
  tmpDir?: string
  port?: number
  sleep?: (ms: number) => Promise<void>
}

const defaultProcess = new NodeFunnelProcessRunner()
const defaultFs = new NodeFunnelFileSystem()
const defaultClock = new NodeFunnelClock()
const defaultSleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms)
  })

/**
 * Manages the gateway daemon as a separate process via PID file.
 * Use `start()` to spawn `bun daemon.ts` in the background and `stop()` to
 * terminate it. For an in-process gateway, use `Funnel.gatewayServer` instead.
 */
export class FunnelGateway {
  private readonly process: FunnelProcessRunner
  private readonly fs: FunnelFileSystem
  private readonly clock: FunnelClock
  private readonly dir: string
  private readonly pidFile: string
  private readonly gatewayLog: string
  private readonly tmpDir: string
  private readonly port: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(deps: Deps = {}) {
    this.process = deps.process ?? defaultProcess
    this.fs = deps.fs ?? defaultFs
    this.clock = deps.clock ?? defaultClock
    this.dir = deps.dir ?? FUNNEL_DIR
    this.tmpDir = deps.tmpDir ?? funnelTmpDir()
    this.pidFile = join(this.dir, "gateway.pid")
    this.gatewayLog = join(this.tmpDir, "gateway.log")
    this.port = deps.port ?? DEFAULT_PORT
    this.sleep = deps.sleep ?? defaultSleep
    Object.freeze(this)
  }

  isRunning(): boolean {
    const pid = this.readPid()

    if (!pid) return false

    return this.isProcessAlive(pid)
  }

  getStatus(): { running: boolean; pid: number | null; port: number } {
    const pid = this.readPid()
    const running = pid !== null && this.isProcessAlive(pid)

    return { running, pid: running ? pid : null, port: this.port }
  }

  async start(options: { caffeinate?: boolean } = {}): Promise<boolean> {
    if (this.isRunning()) return true

    this.fs.mkdirSync(this.tmpDir, { recursive: true })

    const gatewayScript = resolveDaemonScript()
    const command = this.buildStartCommand(gatewayScript, options)

    this.process.detach(command, {
      stdoutFile: this.gatewayLog,
      stderrFile: this.gatewayLog,
    })

    const deadline = this.clock.millis() + STARTUP_TIMEOUT_MS

    while (this.clock.millis() < deadline) {
      if (this.isRunning()) return true
      await this.sleep(POLL_INTERVAL_MS)
    }

    return this.isRunning()
  }

  buildStartCommand(gatewayScript: string, options: { caffeinate?: boolean } = {}): string[] {
    // The funnel-gateway[<dir>] suffix is a marker in argv that
    // kill-competing-slack-gateways matches against. macOS's process.title
    // is invisible to `ps -o args=`, so we tag argv directly. Windows
    // tasklist/CIM also expose the full command line, so the same marker
    // works for both platforms.
    const tag = `funnel-gateway[${this.dir}]`
    const useCaffeinate = options.caffeinate !== false && globalThis.process.platform === "darwin"

    if (useCaffeinate) return ["caffeinate", "-is", "bun", gatewayScript, tag]

    return ["bun", gatewayScript, tag]
  }

  async stop(): Promise<boolean> {
    const pid = this.readPid()

    if (!pid) return true

    if (!this.isProcessAlive(pid)) {
      this.removePid()
      return true
    }

    try {
      this.process.kill(pid, "SIGTERM")
    } catch {
      return false
    }

    const deadline = this.clock.millis() + SIGTERM_TIMEOUT_MS

    while (this.clock.millis() < deadline) {
      if (!this.isProcessAlive(pid)) {
        this.removePid()
        return true
      }

      await this.sleep(POLL_INTERVAL_MS)
    }

    try {
      this.process.kill(pid, "SIGKILL")
    } catch {
      // ignore
    }

    await this.sleep(SIGKILL_GRACE_MS)
    this.removePid()

    return !this.isProcessAlive(pid)
  }

  async restart(
    options: { onlyIfRunning?: boolean; caffeinate?: boolean } = {},
  ): Promise<{ ok: boolean; wasRunning: boolean; stopped: boolean; started: boolean }> {
    const wasRunning = this.isRunning()

    if (options.onlyIfRunning && !wasRunning) {
      return { ok: true, wasRunning: false, stopped: false, started: false }
    }

    const stopped = wasRunning ? await this.stop() : true

    if (!stopped) {
      return { ok: false, wasRunning, stopped: false, started: false }
    }

    const started = await this.start({ caffeinate: options.caffeinate })

    return { ok: started, wasRunning, stopped, started }
  }

  getGatewayLog(): string {
    return this.gatewayLog
  }

  getPort(): number {
    return this.port
  }

  private readPid(): number | null {
    if (!this.fs.existsSync(this.pidFile)) return null

    try {
      const content = this.fs.readFileSync(this.pidFile).trim()
      const pid = Number(content)

      if (!pid || pid <= 0) return null

      return pid
    } catch {
      return null
    }
  }

  private removePid(): void {
    this.fs.unlink(this.pidFile)
  }

  private isProcessAlive(pid: number): boolean {
    return this.process.isAlive(pid)
  }
}
