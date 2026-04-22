import { join } from "node:path"
import type { FunnelConnectorAdapter } from "@/modules/connectors/funnel-connector-adapter"
import type { FunnelConnectorListener } from "@/modules/connectors/funnel-connector-listener"
import { FunnelConnectorTypeStore } from "@/modules/connectors/funnel-connector-type-store"
import { DEFAULT_FUNNEL_DIR } from "@/modules/connectors/funnel-json-connector-store"
import { FunnelScheduleListener } from "@/modules/connectors/funnel-schedule-listener"
import { ScheduleLastFiredStore } from "@/modules/connectors/schedule-last-fired-store"
import {
  type ScheduleConnectorConfig,
  type ScheduleEntry,
  scheduleEntrySchema,
} from "@/modules/connectors/schedule-connector-schema"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"

type Deps = {
  fs?: FunnelFileSystem
  dir?: string
}

const defaultFs = new NodeFunnelFileSystem()

export class FunnelScheduleStore extends FunnelConnectorTypeStore<ScheduleConnectorConfig> {
  readonly type = "schedule" as const
  private readonly fs: FunnelFileSystem
  private readonly baseDir: string
  private readonly dir: string

  constructor(deps: Deps = {}) {
    super()
    this.fs = deps.fs ?? defaultFs
    this.baseDir = deps.dir ?? DEFAULT_FUNNEL_DIR
    this.dir = join(this.baseDir, "connectors", "schedule")
    Object.freeze(this)
  }

  list(): ScheduleConnectorConfig[] {
    if (!this.fs.existsSync(this.dir)) return []

    const files = this.fs.readdirSync(this.dir).filter((f) => f.endsWith(".jsonl"))
    const configs: ScheduleConnectorConfig[] = []

    for (const file of files) {
      const name = file.slice(0, -6)
      const config = this.get(name)

      if (config) configs.push(config)
    }

    return configs
  }

  get(name: string): ScheduleConnectorConfig | null {
    const path = this.pathFor(name)

    if (!this.fs.existsSync(path)) return null

    return { type: "schedule", name, entries: this.readEntries(name) }
  }

  has(name: string): boolean {
    return this.fs.existsSync(this.pathFor(name))
  }

  add(config: ScheduleConnectorConfig): void {
    if (this.has(config.name)) throw new Error(`connector "${config.name}" already exists`)

    this.fs.mkdirSync(this.dir, { recursive: true })
    const lines = config.entries.map((e) => JSON.stringify(e)).join("\n")
    this.fs.writeFileSync(this.pathFor(config.name), lines ? `${lines}\n` : "")
  }

  remove(name: string): void {
    if (!this.has(name)) throw new Error(`connector "${name}" not found`)

    this.fs.unlink(this.pathFor(name))
    this.fs.unlink(this.statePathFor(name))
  }

  rename(oldName: string, newName: string): void {
    if (!this.has(oldName)) throw new Error(`connector "${oldName}" not found`)
    if (this.has(newName)) throw new Error(`connector "${newName}" already exists`)

    const content = this.fs.readFileSync(this.pathFor(oldName))
    this.fs.writeFileSync(this.pathFor(newName), content)
    this.fs.unlink(this.pathFor(oldName))

    if (this.fs.existsSync(this.statePathFor(oldName))) {
      const state = this.fs.readFileSync(this.statePathFor(oldName))
      this.fs.writeFileSync(this.statePathFor(newName), state)
      this.fs.unlink(this.statePathFor(oldName))
    }
  }

  addEntry(name: string, entry: Omit<ScheduleEntry, "id"> & { id?: string }): ScheduleEntry {
    if (!this.has(name)) throw new Error(`connector "${name}" not found`)

    const full: ScheduleEntry = {
      id: entry.id ?? crypto.randomUUID(),
      cron: entry.cron,
      prompt: entry.prompt,
      enabled: entry.enabled ?? true,
    }

    this.fs.appendFileSync(this.pathFor(name), `${JSON.stringify(full)}\n`)

    return full
  }

  removeEntry(name: string, id: string): void {
    const entries = this.readEntries(name)
    const next = entries.filter((e) => e.id !== id)

    if (next.length === entries.length) throw new Error(`schedule entry "${id}" not found`)

    const content = next.map((e) => JSON.stringify(e)).join("\n")
    this.fs.writeFileSync(this.pathFor(name), content ? `${content}\n` : "")
  }

  createListener(config: ScheduleConnectorConfig): FunnelConnectorListener {
    return new FunnelScheduleListener({
      config,
      store: this,
      lastFiredStore: this.createLastFiredStore(config.name),
    })
  }

  createAdapter(_config: ScheduleConnectorConfig): FunnelConnectorAdapter | null {
    return null
  }

  private createLastFiredStore(name: string): ScheduleLastFiredStore {
    return new ScheduleLastFiredStore({ connector: name, fs: this.fs, dir: this.baseDir })
  }

  private pathFor(name: string): string {
    return join(this.dir, `${name}.jsonl`)
  }

  private statePathFor(name: string): string {
    return join(this.dir, `${name}.state.json`)
  }

  private readEntries(name: string): ScheduleEntry[] {
    const path = this.pathFor(name)

    if (!this.fs.existsSync(path)) return []

    const content = this.fs.readFileSync(path)
    const lines = content.split("\n").filter((l) => l.trim().length > 0)
    const entries: ScheduleEntry[] = []

    for (const line of lines) {
      const parsed = JSON.parse(line)
      const result = scheduleEntrySchema.safeParse(parsed)

      if (!result.success) {
        throw new Error(
          `invalid schedule entry in "${name}": ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ")}`,
        )
      }

      entries.push(result.data)
    }

    return entries
  }
}
