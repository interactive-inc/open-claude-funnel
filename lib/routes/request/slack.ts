import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/request/slack.help"

const parseBody = (raw: string | undefined): unknown => {
  if (!raw) return {}

  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new HTTPException(400, {
      message: `body is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}

export const requestSlackHandler = factory.createHandlers(
  zValidator("param", z.object({ method: z.string() })),
  zValidator(
    "query",
    z.object({
      connector: z.string(),
      path: z.string(),
      body: z.string().optional(),
    }),
    help,
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    if (param.method.toLowerCase() !== "post") {
      throw new HTTPException(400, {
        message: `slack only supports POST (got "${param.method}")`,
      })
    }

    const connector = funnel.connectors.get(query.connector)

    if (!connector) {
      throw new HTTPException(404, { message: `connector "${query.connector}" not found` })
    }

    if (connector.type !== "slack") {
      throw new HTTPException(400, {
        message: `connector "${query.connector}" is type "${connector.type}", not "slack"`,
      })
    }

    const result = await funnel.connectors.call(query.connector, {
      method: "POST",
      path: query.path,
      body: parseBody(query.body),
    })

    return c.text(JSON.stringify(result, null, 2))
  },
)
