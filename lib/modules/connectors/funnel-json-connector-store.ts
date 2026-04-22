import { homedir } from "node:os"
import { join } from "node:path"
import type { ZodType } from "zod"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"

const defaultFs = new NodeFunnelFileSystem()

export const DEFAULT_FUNNEL_DIR = join(homedir(), ".funnel")

type Props<TConfig> = {
  type: string
  schema: ZodType<TConfig>
  fs?: FunnelFileSystem
  dir?: string
}

export class FunnelJsonConnectorStore<TConfig extends { type: string; name: string }> {
  private readonly type: string
  private readonly schema: ZodType<TConfig>
  private readonly fs: FunnelFileSystem
  private readonly dir: string

  constructor(props: Props<TConfig>) {
    this.type = props.type
    this.schema = props.schema
    this.fs = props.fs ?? defaultFs
    const base = props.dir ?? DEFAULT_FUNNEL_DIR
    this.dir = join(base, "connectors", props.type)
    Object.freeze(this)
  }

  list(): TConfig[] {
    if (!this.fs.existsSync(this.dir)) return []

    const files = this.fs.readdirSync(this.dir).filter((f) => f.endsWith(".json"))
    const configs: TConfig[] = []

    for (const file of files) {
      const name = file.slice(0, -5)
      const config = this.get(name)

      if (config) configs.push(config)
    }

    return configs
  }

  get(name: string): TConfig | null {
    const path = this.pathFor(name)

    if (!this.fs.existsSync(path)) return null

    const content = this.fs.readFileSync(path)
    const parsed = JSON.parse(content)
    const result = this.schema.safeParse(parsed)

    if (!result.success) {
      throw new Error(
        `invalid ${this.type} connector "${name}": ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
      )
    }

    return result.data
  }

  has(name: string): boolean {
    return this.fs.existsSync(this.pathFor(name))
  }

  write(config: TConfig): void {
    this.fs.mkdirSync(this.dir, { recursive: true })
    this.fs.writeFileSync(this.pathFor(config.name), `${JSON.stringify(config, null, 2)}\n`)
  }

  remove(name: string): void {
    if (!this.has(name)) throw new Error(`connector "${name}" not found`)

    this.fs.unlink(this.pathFor(name))
  }

  rename(oldName: string, newName: string): void {
    const config = this.get(oldName)

    if (!config) throw new Error(`connector "${oldName}" not found`)

    if (this.has(newName)) {
      throw new Error(`connector "${newName}" already exists`)
    }

    const renamed = { ...config, name: newName } as TConfig

    this.write(renamed)
    this.fs.unlink(this.pathFor(oldName))
  }

  pathFor(name: string): string {
    return join(this.dir, `${name}.json`)
  }
}
