import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { renderGatewayStatus } from "@/cli/routes/gateway"

const statusHelp = `funnel gateway status / show gateway running status

usage / funnel gateway status

output / valid YAML

programmable / funnel.gateway.getStatus()`

export const gatewayStatusHandler = factory.createHandlers(helpGuard(statusHelp), async (c) =>
  renderGatewayStatus(c),
)
