import type { FunnelConnectorAdapter } from "@/modules/connectors/funnel-connector-adapter"
import { FunnelConnectorTypeStore } from "@/modules/connectors/funnel-connector-type-store"
import type { ConnectorConfig } from "@/modules/connectors/connector-config-schema"

export abstract class FunnelCallableConnectorStore<
  TConfig extends ConnectorConfig,
> extends FunnelConnectorTypeStore<TConfig> {
  abstract createAdapter(config: TConfig): FunnelConnectorAdapter
}
