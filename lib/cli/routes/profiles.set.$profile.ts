import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { parseProfileRecipe } from "@/cli/routes/parse-profile-recipe"
import { zValidator } from "@/cli/router/validator"

export const setHelp = `funnel profiles <name> set — update a profile

usage: funnel profiles <name> set [--path <path>] [--channel <channel-name>] [recipe]

options:
  --path        working directory passed to claude as cwd
  --channel     channel name (resolved to channel id internally)
  --agent       sub-agent name, prepended to the launch argv as --agent <name>
  --options     extra launch argv as one whitespace-split string (e.g. "--brief")
  --env         env vars layered under the process, as "KEY=VAL,KEY2=VAL2"
  --resume / --no-resume  toggle claude session reuse

Only the flags you pass are changed; --agent and --options together replace
the profile's whole options list.`

export const profilesSetHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator(
    "query",
    z.object({
      path: z.string().optional(),
      channel: z.string().optional(),
      agent: z.string().optional(),
      options: z.string().optional(),
      env: z.string().optional(),
      resume: z.string().optional(),
      "no-resume": z.string().optional(),
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

    const recipe = parseProfileRecipe(query)

    funnel.profiles.update(param.profile, {
      path: query.path,
      channelId: channel?.id,
      options: recipe.options,
      env: recipe.env,
      resume: recipe.resume,
    })

    return c.text(`updated profile "${param.profile}"`)
  },
)
