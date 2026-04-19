import { type FileStat, FunnelFileSystem } from "@/modules/fs/funnel-file-system"

type Props = {
  dirs?: string[]
  files?: Record<string, string>
  mtimes?: Record<string, number>
  now?: () => number
}

export class MemoryFunnelFileSystem extends FunnelFileSystem {
  private readonly dirs: Set<string>
  private readonly files: Map<string, string>
  private readonly mtimes: Map<string, number>
  private readonly now: () => number

  constructor(props: Props = {}) {
    super()
    this.dirs = new Set(props.dirs ?? [])
    this.files = new Map(Object.entries(props.files ?? {}))
    this.mtimes = new Map(Object.entries(props.mtimes ?? {}))
    this.now = props.now ?? (() => Date.now())
  }

  existsSync(path: string): boolean {
    return this.dirs.has(path) || this.files.has(path)
  }

  readFileSync(path: string): string {
    return this.files.get(path) ?? ""
  }

  writeFileSync(path: string, data: string): void {
    this.files.set(path, data)
    this.touch(path)
  }

  appendFileSync(path: string, data: string): void {
    const prev = this.files.get(path) ?? ""
    this.files.set(path, prev + data)
    this.touch(path)
  }

  unlink(path: string): void {
    this.files.delete(path)
    this.mtimes.delete(path)
  }

  mkdirSync(path: string): void {
    this.dirs.add(path)
  }

  readdirSync(path: string): string[] {
    const prefix = path.endsWith("/") ? path : `${path}/`
    const names: string[] = []

    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue

      const rest = file.slice(prefix.length)

      if (!rest.includes("/")) names.push(rest)
    }

    return names
  }

  statSync(path: string): FileStat {
    const mtimeMs = this.mtimes.get(path)

    if (mtimeMs === undefined) {
      throw new Error(`not found: ${path}`)
    }

    return { mtimeMs }
  }

  setMtime(path: string, mtimeMs: number): void {
    this.mtimes.set(path, mtimeMs)
  }

  private touch(path: string): void {
    if (!this.mtimes.has(path)) this.mtimes.set(path, this.now())
    else this.mtimes.set(path, this.now())
  }
}
