import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const renameHelp = `funnel channels rename — rename a channel

usage:
  funnel channels rename <old> <new>
  funnel channels <old> rename <new>`

export const channelsRenameHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), newName: z.string() })),
  zValidator("query", z.object({}), renameHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.channels.rename(param.channel, param.newName)

    return c.text(`renamed channel "${param.channel}" to "${param.newName}"`)
  },
)
