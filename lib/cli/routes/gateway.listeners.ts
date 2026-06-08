import { HTTPException } from "hono/http-exception"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { renderYaml } from "@/cli/yaml-render"

const listenersHelp = `funnel gateway listeners / show running connector listeners

usage / funnel gateway listeners

output / valid YAML

programmable / funnel.listeners.list() / funnel.recovery.restartAllDeadListeners()`

export const gatewayListenersHandler = factory.createHandlers(
  helpGuard(listenersHelp),
  async (c) => {
    const funnel = c.env.funnel
    const result = await funnel.listeners.list()

    if (result.state === "offline") {
      throw new HTTPException(503, { message: "funnel gateway: not running" })
    }

    if (result.state === "error") {
      throw new HTTPException(503, { message: `funnel gateway: ${result.reason}` })
    }

    return c.text(renderYaml({ listeners: result.listeners }))
  },
)
