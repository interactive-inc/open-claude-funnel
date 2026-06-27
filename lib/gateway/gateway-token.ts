import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"
import { FUNNEL_DIR } from "@/engine/settings/settings-store"

const TOKEN_FILE_NAME = "gateway.token"
const TOKEN_BYTES = 32

type Deps = {
  fs?: FunnelFileSystem
  dir?: string
  generate?: () => string
}

const defaultFs = new NodeFunnelFileSystem()

const defaultGenerate = (): string => {
  const buf = new Uint8Array(TOKEN_BYTES)
  crypto.getRandomValues(buf)

  return [...buf].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Reads / generates the gateway daemon token used to authenticate
 * `/listeners*`, `/status`, and `/ws` connections.
 *
 * Token file: `<dir>/gateway.token` (default `~/.funnel/gateway.token`),
 * written with mode 0600. Clients on the same machine as the daemon read
 * the file directly; the token never leaves the user's home directory.
 */
export class FunnelGatewayToken {
  private readonly fs: FunnelFileSystem
  private readonly path: string
  private readonly generate: () => string

  constructor(deps: Deps = {}) {
    this.fs = deps.fs ?? defaultFs
    this.path = join(deps.dir ?? FUNNEL_DIR, TOKEN_FILE_NAME)
    this.generate = deps.generate ?? defaultGenerate
    Object.freeze(this)
  }

  read(): string | null {
    if (!this.fs.existsSync(this.path)) return null

    const value = this.fs.readFileSync(this.path).trim()

    return value.length > 0 ? value : null
  }

  /**
   * Returns the existing token or, if missing, generates one and writes it
   * with mode 0600. Read+write runs inside an exclusive lock so two
   * concurrent `ensure()` calls (a daemon spawn racing a CLI helper that
   * reads the token before the gateway PID lock is acquired) cannot each
   * persist a different token and leave one side authenticating against a
   * value the other never sees.
   */
  ensure(): string {
    this.fs.mkdirSync(dirname(this.path), { recursive: true })
    return this.fs.withFileLock(`${this.path}.lock`, () => {
      const existing = this.read()

      if (existing) return existing

      const token = this.generate()
      this.fs.writeSecretFileSync(this.path, `${token}\n`)
      return token
    })
  }

  getPath(): string {
    return this.path
  }
}

export const DEFAULT_GATEWAY_TOKEN_PATH = join(homedir(), ".funnel", TOKEN_FILE_NAME)
