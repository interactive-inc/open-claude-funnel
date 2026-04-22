import type { FunnelConnectorAdapter } from "@/modules/connectors/funnel-connector-adapter"
import type { FunnelConnectorListener } from "@/modules/connectors/funnel-connector-listener"
import type { ConnectorConfig } from "@/modules/connectors/connector-config-schema"

export abstract class FunnelConnectorTypeStore<TConfig extends ConnectorConfig> {
  abstract readonly type: TConfig["type"]

  abstract list(): TConfig[]

  abstract get(name: string): TConfig | null

  abstract has(name: string): boolean

  abstract add(config: TConfig): void

  abstract remove(name: string): void

  abstract rename(oldName: string, newName: string): void

  abstract createListener(config: TConfig): FunnelConnectorListener

  abstract createAdapter(config: TConfig): FunnelConnectorAdapter | null

  createAllListeners(): { config: TConfig; listener: FunnelConnectorListener }[] {
    return this.list().map((config) => ({ config, listener: this.createListener(config) }))
  }
}
