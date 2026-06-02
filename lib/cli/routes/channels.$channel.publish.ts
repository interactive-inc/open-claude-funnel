import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

const querySchema = z
  .object({
    content: z.string().min(1, { message: "--content is required" }),
    connector: z.string().min(1).optional(),
  })
  .passthrough()

export const channelsPublishHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", querySchema),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel

    const meta: Record<string, string> = {}

    for (const [k, v] of new URL(c.req.url).searchParams) {
      if (k.startsWith("meta-")) meta[k.slice("meta-".length)] = v
    }

    const result = await funnel.publisher.publish(param.channel, {
      content: query.content,
      connector: query.connector,
      meta: Object.keys(meta).length > 0 ? meta : undefined,
    })

    if (result.state === "offline") {
      throw new HTTPException(503, {
        message: "gateway daemon is not running — start it with `fnl gateway start`",
      })
    }

    if (result.state === "error") {
      throw new HTTPException(502, { message: result.reason })
    }

    return c.text(`published (offset=${result.offset})`)
  },
)
