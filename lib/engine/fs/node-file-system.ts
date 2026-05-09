import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { type FileStat, FunnelFileSystem } from "@/engine/fs/file-system"

const SECRET_MODE = 0o600

export class NodeFunnelFileSystem extends FunnelFileSystem {
  constructor() {
    super()
    Object.freeze(this)
  }

  existsSync(path: string): boolean {
    return existsSync(path)
  }

  readFileSync(path: string): string {
    return readFileSync(path, "utf-8")
  }

  writeFileSync(path: string, data: string): void {
    writeFileSync(path, data)
  }

  writeSecretFileSync(path: string, data: string): void {
    writeFileSync(path, data, { mode: SECRET_MODE })
    try {
      chmodSync(path, SECRET_MODE)
    } catch {
      // ignore — best-effort tightening for files that already existed with looser perms
    }
  }

  appendFileSync(path: string, data: string): void {
    appendFileSync(path, data)
  }

  unlink(path: string): void {
    try {
      unlinkSync(path)
    } catch {
      // ignore
    }
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    mkdirSync(path, { recursive: options?.recursive ?? false })
  }

  readdirSync(path: string): string[] {
    return readdirSync(path)
  }

  statSync(path: string): FileStat {
    const stat = statSync(path)

    return { mtimeMs: stat.mtimeMs, mode: stat.mode & 0o777 }
  }
}
