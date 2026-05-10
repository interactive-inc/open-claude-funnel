import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const setHelp = `funnel profiles <name> set — update a profile

usage: funnel profiles <name> set [--path <path>] [--sub-agent <agent>] [--channel <channel-name>]`

export const profilesSetHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator(
    "query",
    z.object({
      path: z.string().optional(),
      "sub-agent": z.string().optional(),
      channel: z.string().optional(),
    }),
    setHelp,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    let channelId: string | undefined

    if (query.channel !== undefined) {
      const channel = funnel.channels.get(query.channel)

      if (!channel) {
        throw new HTTPException(400, { message: `channel "${query.channel}" not found` })
      }

      channelId = channel.id
    }

    funnel.profiles.update(param.profile, {
      path: query.path,
      subAgent: query["sub-agent"],
      channelId,
    })

    return c.text(`updated profile "${param.profile}"`)
  },
)
