import type { FunnelConnectorAdapter } from "@/modules/connectors/funnel-connector-adapter"
import type { FunnelConnectorListener } from "@/modules/connectors/funnel-connector-listener"
import { FunnelConnectorTypeStore } from "@/modules/connectors/funnel-connector-type-store"
import {
  DEFAULT_FUNNEL_DIR,
  FunnelJsonConnectorStore,
} from "@/modules/connectors/funnel-json-connector-store"
import { FunnelGhAdapter } from "@/modules/connectors/funnel-gh-adapter"
import { FunnelGhListener } from "@/modules/connectors/funnel-gh-listener"
import {
  type GhConnectorConfig,
  ghConnectorSchema,
} from "@/modules/connectors/gh-connector-schema"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"

type Deps = {
  fs?: FunnelFileSystem
  dir?: string
}

export type GhUpdateFields = {
  pollInterval?: number
}

export class FunnelGhStore extends FunnelConnectorTypeStore<GhConnectorConfig> {
  readonly type = "gh" as const
  private readonly store: FunnelJsonConnectorStore<GhConnectorConfig>

  constructor(deps: Deps = {}) {
    super()
    this.store = new FunnelJsonConnectorStore<GhConnectorConfig>({
      type: "gh",
      schema: ghConnectorSchema,
      fs: deps.fs,
      dir: deps.dir ?? DEFAULT_FUNNEL_DIR,
    })
    Object.freeze(this)
  }

  list(): GhConnectorConfig[] {
    return this.store.list()
  }

  get(name: string): GhConnectorConfig | null {
    return this.store.get(name)
  }

  has(name: string): boolean {
    return this.store.has(name)
  }

  add(config: GhConnectorConfig): void {
    if (this.has(config.name)) throw new Error(`connector "${config.name}" already exists`)

    this.store.write(config)
  }

  update(name: string, fields: GhUpdateFields): void {
    const current = this.store.get(name)

    if (!current) throw new Error(`connector "${name}" not found`)

    this.store.write({
      ...current,
      pollInterval: fields.pollInterval ?? current.pollInterval,
    })
  }

  remove(name: string): void {
    this.store.remove(name)
  }

  rename(oldName: string, newName: string): void {
    this.store.rename(oldName, newName)
  }

  createListener(config: GhConnectorConfig): FunnelConnectorListener {
    return new FunnelGhListener({ config })
  }

  createAdapter(_config: GhConnectorConfig): FunnelConnectorAdapter {
    return new FunnelGhAdapter()
  }
}
