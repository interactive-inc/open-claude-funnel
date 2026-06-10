import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/engine/yaml/yaml-render"

const showHelp = `funnel channels <name> / show channel details

subcommands:
  set delivery fanout|exclusive / change routing mode
  publish --content=... / push content into the channel
  validate / check connector configuration
  rename <new> / rename this channel
  connectors / manage connectors (add, remove, set, rename, request, schedules)

output / valid YAML`

export const channelsShowHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  helpGuard(showHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel
    const channel = funnel.channels.get(param.channel)

    if (!channel) {
      throw new HTTPException(404, { message: `channel "${param.channel}" not found` })
    }

    return c.text(
      renderYaml({
        id: channel.id,
        name: channel.name,
        delivery: channel.delivery,
        connectors: channel.connectors.map((conn) => ({
          id: conn.id,
          name: conn.name,
          type: conn.type,
        })),
      }),
    )
  },
)
