import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/connectors/call.help"

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

export const connectorsCallHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      method: z.string(),
      path: z.string(),
      body: z.string().optional(),
    }),
    help,
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const result = await funnel.connectors.call(param.name, {
      method: query.method,
      path: query.path,
      body: parseBody(query.body),
    })

    return c.text(JSON.stringify(result, null, 2))
  },
)
