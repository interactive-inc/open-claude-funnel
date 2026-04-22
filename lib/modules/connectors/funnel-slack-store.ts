import type { FunnelConnectorAdapter } from "@/modules/connectors/funnel-connector-adapter"
import type { FunnelConnectorListener } from "@/modules/connectors/funnel-connector-listener"
import { FunnelConnectorTypeStore } from "@/modules/connectors/funnel-connector-type-store"
import {
  DEFAULT_FUNNEL_DIR,
  FunnelJsonConnectorStore,
} from "@/modules/connectors/funnel-json-connector-store"
import { FunnelSlackAdapter } from "@/modules/connectors/funnel-slack-adapter"
import { FunnelSlackListener } from "@/modules/connectors/funnel-slack-listener"
import {
  type SlackConnectorConfig,
  slackConnectorSchema,
} from "@/modules/connectors/slack-connector-schema"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"

type Deps = {
  fs?: FunnelFileSystem
  dir?: string
}

export type SlackUpdateFields = {
  botToken?: string
  appToken?: string
}

export class FunnelSlackStore extends FunnelConnectorTypeStore<SlackConnectorConfig> {
  readonly type = "slack" as const
  private readonly store: FunnelJsonConnectorStore<SlackConnectorConfig>

  constructor(deps: Deps = {}) {
    super()
    this.store = new FunnelJsonConnectorStore<SlackConnectorConfig>({
      type: "slack",
      schema: slackConnectorSchema,
      fs: deps.fs,
      dir: deps.dir ?? DEFAULT_FUNNEL_DIR,
    })
    Object.freeze(this)
  }

  list(): SlackConnectorConfig[] {
    return this.store.list()
  }

  get(name: string): SlackConnectorConfig | null {
    return this.store.get(name)
  }

  has(name: string): boolean {
    return this.store.has(name)
  }

  add(config: SlackConnectorConfig): void {
    if (this.has(config.name)) throw new Error(`connector "${config.name}" already exists`)

    this.store.write(config)
  }

  update(name: string, fields: SlackUpdateFields): void {
    const current = this.store.get(name)

    if (!current) throw new Error(`connector "${name}" not found`)

    this.store.write({
      ...current,
      botToken: fields.botToken ?? current.botToken,
      appToken: fields.appToken ?? current.appToken,
    })
  }

  remove(name: string): void {
    this.store.remove(name)
  }

  rename(oldName: string, newName: string): void {
    this.store.rename(oldName, newName)
  }

  createListener(config: SlackConnectorConfig): FunnelConnectorListener {
    return new FunnelSlackListener({ config })
  }

  createAdapter(config: SlackConnectorConfig): FunnelConnectorAdapter {
    return new FunnelSlackAdapter({ config })
  }
}
