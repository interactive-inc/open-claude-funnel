import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { queryToCliArgs } from "@/cli/router/query-to-cli-args"
import { zValidator } from "@/cli/router/validator"

export const launchHelp = `funnel profiles <name> run — launch a profile (sugar for fnl claude)

usage: funnel profiles <name> run [additional claude args...]
       funnel profiles <name>     (alias)`

const RESERVED_KEYS: string[] = []

export const profilesLaunchHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  zValidator("query", z.object({}).passthrough(), launchHelp),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const profile = funnel.profiles.get(param.profile)

    if (!profile) {
      throw new HTTPException(404, { message: `profile "${param.profile}" not found` })
    }

    const exitCode = await funnel.claude.launch({
      channel: profile.channelId,
      cwd: profile.path,
      userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
      profileName: profile.name,
    })

    process.exit(exitCode)
  },
)
