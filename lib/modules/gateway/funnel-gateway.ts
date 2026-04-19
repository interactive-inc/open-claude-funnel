import { join, resolve } from "node:path"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"
import { FunnelProcessRunner } from "@/modules/process/funnel-process-runner"
import { NodeFunnelProcessRunner } from "@/modules/process/node-funnel-process-runner"
import { FUNNEL_DIR } from "@/modules/settings/funnel-settings-store"

const DEFAULT_PORT = 9742
const PID_FILE = join(FUNNEL_DIR, "gateway.pid")
const LOG_DIR = "/tmp/funnel/events"
const GATEWAY_LOG = "/tmp/funnel/gateway.log"
const TMP_DIR = "/tmp/funnel"

type Deps = {
  process?: FunnelProcessRunner
  fs?: FunnelFileSystem
}

const defaultProcess = new NodeFunnelProcessRunner()
const defaultFs = new NodeFunnelFileSystem()

export class FunnelGateway {
  private readonly process: FunnelProcessRunner
  private readonly fs: FunnelFileSystem

  constructor(deps: Deps = {}) {
    this.process = deps.process ?? defaultProcess
    this.fs = deps.fs ?? defaultFs
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

    return { running, pid: running ? pid : null, port: DEFAULT_PORT }
  }

  async start(options: { caffeinate?: boolean } = {}): Promise<boolean> {
    if (this.isRunning()) return true

    this.fs.mkdirSync(TMP_DIR, { recursive: true })

    const gatewayScript = resolve(import.meta.dir, "./daemon.ts")
    const command = this.buildStartCommand(gatewayScript, options)

    this.process.detach(["bash", "-c", command])

    await Bun.sleep(800)

    return this.isRunning()
  }

  buildStartCommand(gatewayScript: string, options: { caffeinate?: boolean } = {}): string {
    const useCaffeinate = options.caffeinate !== false && globalThis.process.platform === "darwin"
    const prefix = useCaffeinate ? "caffeinate -i " : ""

    return `nohup ${prefix}bun ${gatewayScript} >> ${GATEWAY_LOG} 2>&1 &`
  }

  async stop(): Promise<boolean> {
    const pid = this.readPid()

    if (!pid) return true

    if (!this.isProcessAlive(pid)) {
      this.removePid()
      return true
    }

    try {
      globalThis.process.kill(pid, "SIGTERM")
    } catch {
      return false
    }

    const deadline = Date.now() + 2000

    while (Date.now() < deadline) {
      if (!this.isProcessAlive(pid)) {
        this.removePid()
        return true
      }

      await Bun.sleep(100)
    }

    try {
      globalThis.process.kill(pid, "SIGKILL")
    } catch {
      // ignore
    }

    await Bun.sleep(200)
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

  getLogDir(): string {
    return LOG_DIR
  }

  getGatewayLog(): string {
    return GATEWAY_LOG
  }

  private readPid(): number | null {
    if (!this.fs.existsSync(PID_FILE)) return null

    try {
      const content = this.fs.readFileSync(PID_FILE).trim()
      const pid = Number(content)

      if (!pid || pid <= 0) return null

      return pid
    } catch {
      return null
    }
  }

  private removePid(): void {
    this.fs.unlink(PID_FILE)
  }

  private isProcessAlive(pid: number): boolean {
    const result = this.process.runSync(["ps", "-p", String(pid), "-o", "state="])

    if (result.exitCode !== 0) return false

    const state = result.stdout.trim()

    if (!state) return false

    return !state.startsWith("Z")
  }
}
