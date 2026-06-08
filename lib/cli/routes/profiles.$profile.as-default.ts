import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"

const asDefaultHelp = `funnel profiles <name> as-default — move profile to the front of the list

usage: funnel profiles <name> as-default

the first profile in the list is treated as the default for fnl claude.`

export const profilesAsDefaultHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  helpGuard(asDefaultHelp),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel
    const { profiles, claude } = c.env

    profiles.asDefault(param.profile)

    return c.text(`profile "${param.profile}" is now the default`)
  },
)
