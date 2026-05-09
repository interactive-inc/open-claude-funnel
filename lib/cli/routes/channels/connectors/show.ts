import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/channels/connectors/show.help"

export const channelsConnectorsShowHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const connector = funnel.channels.getConnector(param.channel, param.connector)

    if (!connector) {
      throw new HTTPException(404, {
        message: `connector "${param.connector}" not found in channel "${param.channel}"`,
      })
    }

    return c.text(JSON.stringify(connector, null, 2))
  },
)
