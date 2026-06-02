import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const channelsRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", z.object({})),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel

    funnel.channels.remove(param.channel)

    return c.text(`removed channel "${param.channel}"`)
  },
)
