import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const setHelp = `funnel profiles <name> set — update a profile

usage: funnel profiles <name> set [--path <path>] [--sub-agent <agent>] [--channel <channel-name>] [--brief | --no-brief]`

export const profilesSetHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator(
    "query",
    z.object({
      path: z.string().optional(),
      "sub-agent": z.string().optional(),
      channel: z.string().optional(),
      brief: z.coerce.boolean().optional(),
      "no-brief": z.coerce.boolean().optional(),
    }),
    setHelp,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const channel = query.channel !== undefined ? funnel.channels.get(query.channel) : null

    if (query.channel !== undefined && !channel) {
      throw new HTTPException(400, { message: `channel "${query.channel}" not found` })
    }

    const brief = query["no-brief"] ? false : query.brief

    funnel.profiles.update(param.profile, {
      path: query.path,
      subAgent: query["sub-agent"],
      channelId: channel?.id,
      ...(brief !== undefined ? { brief } : {}),
    })

    return c.text(`updated profile "${param.profile}"`)
  },
)
