import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { type FileStat, FunnelFileSystem } from "@/modules/fs/funnel-file-system"

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

    return { mtimeMs: stat.mtimeMs }
  }
}
