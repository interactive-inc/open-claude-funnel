import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/cli/yaml-render"

const showHelp = `funnel channels <name> / show channel details

output / valid YAML`

export const channelsShowHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", z.object({}), showHelp),
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
