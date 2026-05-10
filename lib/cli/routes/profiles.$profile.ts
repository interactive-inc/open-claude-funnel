import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const addHelp = `funnel profiles add — add a profile

usage: funnel profiles add <name> --path <path> --sub-agent <agent> --channel <channel>`

export const profilesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator(
    "query",
    z.object({
      path: z.string(),
      "sub-agent": z.string(),
      channel: z.string(),
    }),
    addHelp,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    funnel.profiles.add({
      name: param.profile,
      path: query.path,
      subAgent: query["sub-agent"],
      channelId: query.channel,
    })

    return c.text(`added profile "${param.profile}"`)
  },
)

export const setHelp = `funnel profiles <name> set — update a profile

usage: funnel profiles <name> set [--path <path>] [--sub-agent <agent>] [--channel <channel>]`

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

    funnel.profiles.update(param.profile, {
      path: query.path,
      subAgent: query["sub-agent"],
      channelId: query.channel,
    })

    return c.text(`updated profile "${param.profile}"`)
  },
)

export const removeHelp = `funnel profiles remove — remove a profile

usage: funnel profiles remove <name>`

export const profilesRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator("query", z.object({}), removeHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel

    funnel.profiles.remove(param.profile)

    return c.text(`removed profile "${param.profile}"`)
  },
)
