import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/channels/connectors/request.help"

export const channelsConnectorsRequestHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator(
    "query",
    z
      .object({
        method: z.string(),
      })
      .passthrough(),
    help,
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const passthrough: Record<string, string> = {}

    for (const [k, v] of new URL(c.req.url).searchParams) {
      if (k === "method") continue
      passthrough[k] = v
    }

    try {
      const response = await funnel.channels.call(param.channel, param.connector, {
        method: query.method,
        path: query.method,
        body: passthrough,
      })

      return c.text(typeof response === "string" ? response : JSON.stringify(response, null, 2))
    } catch (error) {
      throw new HTTPException(400, {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  },
)
