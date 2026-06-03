import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { parseProfileRecipe } from "@/cli/routes/parse-profile-recipe"
import { zValidator } from "@/cli/router/validator"

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
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const { profiles, claude } = c.env

    const channel = query.channel !== undefined ? funnel.channels.get(query.channel) : null

    if (query.channel !== undefined && !channel) {
      throw new HTTPException(400, { message: `channel "${query.channel}" not found` })
    }

    const recipe = parseProfileRecipe(query)

    profiles.update(param.profile, {
      path: query.path,
      channelId: channel?.id,
      options: recipe.options,
      env: recipe.env,
      resume: recipe.resume,
    })

    return c.text(`updated profile "${param.profile}"`)
  },
)
