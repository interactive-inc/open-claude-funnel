import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/request/discord.help"

const ALLOWED_METHODS = new Set(["get", "post", "put", "patch", "delete"])

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

export const requestDiscordHandler = factory.createHandlers(
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

    const method = param.method.toLowerCase()

    if (!ALLOWED_METHODS.has(method)) {
      throw new HTTPException(400, {
        message: `unsupported method "${param.method}" (allowed: ${[...ALLOWED_METHODS].join(", ")})`,
      })
    }

    const connector = funnel.connectors.get(query.connector)

    if (!connector) {
      throw new HTTPException(404, { message: `connector "${query.connector}" not found` })
    }

    if (connector.type !== "discord") {
      throw new HTTPException(400, {
        message: `connector "${query.connector}" is type "${connector.type}", not "discord"`,
      })
    }

    const result = await funnel.connectors.call(query.connector, {
      method: method.toUpperCase(),
      path: query.path,
      body: parseBody(query.body),
    })

    return c.text(JSON.stringify(result, null, 2))
  },
)
