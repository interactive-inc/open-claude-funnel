import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const channelsRenameHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), newName: z.string() })),
  zValidator("query", z.object({})),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel

    funnel.channels.rename(param.channel, param.newName)

    return c.text(`renamed channel "${param.channel}" to "${param.newName}"`)
  },
)
