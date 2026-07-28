import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { notFoundMessage } from "@/cli/routes/not-found-message"
import { parseProfileRecipe } from "@/cli/routes/parse-profile-recipe"
import { zValidator } from "@/cli/router/validator"

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
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const profiles = c.env.profiles

    const channel = funnel.channels.get(query.channel)

    if (!channel) {
      throw new HTTPException(400, {
        message: notFoundMessage({
          kind: "channel",
          name: query.channel,
          available: funnel.channels.list().map((ch) => ch.name),
          nextAction: "fnl channels add <name>",
        }),
      })
    }

    const recipe = parseProfileRecipe(query)

    profiles.add({
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
