import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const addHelp = `funnel profiles add — add a profile

usage: funnel profiles add <name> --path <path> --channel <channel-name>

options:
  --path     working directory passed to claude as cwd
  --channel  channel name (resolved to channel id internally)

Per-launch flags like --agent or --brief now live on the channel itself
(set with \`fnl channels <name> set options ...\`), so profiles are only
\`{ name, path, channelId }\`.`

export const profilesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator(
    "query",
    z.object({
      path: z.string(),
      channel: z.string(),
    }),
    addHelp,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const channel = funnel.channels.get(query.channel)

    if (!channel) {
      throw new HTTPException(400, { message: `channel "${query.channel}" not found` })
    }

    funnel.profiles.add({
      name: param.profile,
      path: query.path,
      channelId: channel.id,
    })

    return c.text(`added profile "${param.profile}"`)
  },
)
