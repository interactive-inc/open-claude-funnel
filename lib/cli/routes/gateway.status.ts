import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { renderGatewayStatus } from "@/cli/routes/gateway"

const statusHelp = `funnel gateway status / show gateway running status

usage / funnel gateway status

output / valid YAML

programmable / funnel.gateway.getStatus()`

export const gatewayStatusHandler = factory.createHandlers(
  zValidator("query", z.object({}), statusHelp),
  async (c) => renderGatewayStatus(c),
)
