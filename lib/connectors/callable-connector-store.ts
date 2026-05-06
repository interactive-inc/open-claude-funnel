import type { FunnelConnectorAdapter } from "@/connectors/connector-adapter";
import { FunnelConnectorTypeStore } from "@/connectors/connector-type-store";
import type { ConnectorConfig } from "@/connectors/connector-config-schema";

export abstract class FunnelCallableConnectorStore<
  TConfig extends ConnectorConfig,
> extends FunnelConnectorTypeStore<TConfig> {
  abstract createAdapter(config: TConfig): FunnelConnectorAdapter;
}
