import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { notFoundMessage } from "@/cli/routes/not-found-message"
import { zValidator } from "@/cli/router/validator"

export const channelsRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", z.object({})),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel

    if (!funnel.channels.get(param.channel)) {
      throw new HTTPException(404, {
        message: notFoundMessage({
          kind: "channel",
          name: param.channel,
          available: funnel.channels.list().map((ch) => ch.name),
          nextAction: "fnl channels add <name>",
        }),
      })
    }

    funnel.channels.remove(param.channel)

    return c.text(`removed channel "${param.channel}"`)
  },
)
