import type { FunnelConnectorAdapter } from "@/modules/connectors/funnel-connector-adapter"
import type { FunnelConnectorListener } from "@/modules/connectors/funnel-connector-listener"
import { FunnelConnectorTypeStore } from "@/modules/connectors/funnel-connector-type-store"
import {
  DEFAULT_FUNNEL_DIR,
  FunnelJsonConnectorStore,
} from "@/modules/connectors/funnel-json-connector-store"
import { FunnelDiscordAdapter } from "@/modules/connectors/funnel-discord-adapter"
import { FunnelDiscordListener } from "@/modules/connectors/funnel-discord-listener"
import {
  type DiscordConnectorConfig,
  discordConnectorSchema,
} from "@/modules/connectors/discord-connector-schema"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"

type Deps = {
  fs?: FunnelFileSystem
  dir?: string
}

export type DiscordUpdateFields = {
  botToken?: string
}

export class FunnelDiscordStore extends FunnelConnectorTypeStore<DiscordConnectorConfig> {
  readonly type = "discord" as const
  private readonly store: FunnelJsonConnectorStore<DiscordConnectorConfig>

  constructor(deps: Deps = {}) {
    super()
    this.store = new FunnelJsonConnectorStore<DiscordConnectorConfig>({
      type: "discord",
      schema: discordConnectorSchema,
      fs: deps.fs,
      dir: deps.dir ?? DEFAULT_FUNNEL_DIR,
    })
    Object.freeze(this)
  }

  list(): DiscordConnectorConfig[] {
    return this.store.list()
  }

  get(name: string): DiscordConnectorConfig | null {
    return this.store.get(name)
  }

  has(name: string): boolean {
    return this.store.has(name)
  }

  add(config: DiscordConnectorConfig): void {
    if (this.has(config.name)) throw new Error(`connector "${config.name}" already exists`)

    this.store.write(config)
  }

  update(name: string, fields: DiscordUpdateFields): void {
    const current = this.store.get(name)

    if (!current) throw new Error(`connector "${name}" not found`)

    this.store.write({
      ...current,
      botToken: fields.botToken ?? current.botToken,
    })
  }

  remove(name: string): void {
    this.store.remove(name)
  }

  rename(oldName: string, newName: string): void {
    this.store.rename(oldName, newName)
  }

  createListener(config: DiscordConnectorConfig): FunnelConnectorListener {
    return new FunnelDiscordListener({ config })
  }

  createAdapter(config: DiscordConnectorConfig): FunnelConnectorAdapter {
    return new FunnelDiscordAdapter({ config })
  }
}
