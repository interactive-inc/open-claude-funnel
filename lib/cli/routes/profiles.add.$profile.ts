import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { parseProfileRecipe } from "@/cli/routes/parse-profile-recipe"
import { zValidator } from "@/cli/router/validator"

export const addHelp = `funnel profiles add — add a profile

usage: funnel profiles add <name> --path <path> --channel <channel-name> [recipe]

options:
  --path        working directory passed to claude as cwd
  --channel     channel name (resolved to channel id internally)
  --agent       sub-agent name, prepended to the launch argv as --agent <name>
  --options     extra launch argv as one whitespace-split string (e.g. "--brief")
  --env         env vars layered under the process, as "KEY=VAL,KEY2=VAL2"
  --no-resume   start a fresh claude session every launch (default resumes)

The launch recipe (--agent / --options / --env / --resume) lives on the
profile; the channel only declares transport (connectors / delivery).`

export const profilesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator(
    "query",
    z.object({
      path: z.string(),
      channel: z.string(),
      agent: z.string().optional(),
      options: z.string().optional(),
      env: z.string().optional(),
      resume: z.string().optional(),
      "no-resume": z.string().optional(),
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

    const recipe = parseProfileRecipe(query)

    funnel.profiles.add({
      name: param.profile,
      path: query.path,
      channelId: channel.id,
      options: recipe.options,
      env: recipe.env,
      resume: recipe.resume,
    })

    return c.text(`added profile "${param.profile}"`)
  },
)
