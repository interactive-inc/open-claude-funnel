import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/cli/yaml-render"

const showHelp = `funnel channels <channel> connectors <connector> / show connector config

subcommands:
  rename <new> / rename this connector
  request --method=... / call outbound API
  schedules / manage schedule entries (schedule type only)

output / valid YAML`

export const channelsConnectorsShowHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  helpGuard(showHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel
    const connector = funnel.channels.getConnector(param.channel, param.connector)

    if (!connector) {
      throw new HTTPException(404, {
        message: `connector "${param.connector}" not found in channel "${param.channel}"`,
      })
    }

    return c.text(renderYaml(connector))
  },
)
