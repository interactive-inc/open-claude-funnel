import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { renderGatewayStatus } from "@/cli/routes/gateway"

export const statusHelp = `funnel gateway status — show gateway running status

usage: funnel gateway status

When running, prints PID, port, and connected channel count. When not running, exits with 503.

examples:
  funnel gateway status
  funnel gateway`

export const gatewayStatusHandler = factory.createHandlers(
  zValidator("query", z.object({}), statusHelp),
  renderGatewayStatus,
)
