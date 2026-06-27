import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { notFoundMessage } from "@/cli/routes/not-found-message"
import { helpGuard } from "@/cli/router/help-guard"
import { queryToCliArgs } from "@/cli/router/query-to-cli-args"
import { zValidator } from "@/cli/router/validator"

const launchHelp = `funnel profiles <name> run — launch a profile (sugar for fnl claude)

usage: funnel profiles <name> run [additional claude args...]
       funnel profiles <name>     (alias)`

const RESERVED_KEYS: string[] = []

export const profilesLaunchHandler = factory.createHandlers(
  zValidator("param", z.object({ profile: z.string() })),
  helpGuard(launchHelp),
  zValidator("query", z.object({}).loose()),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel
    const { profiles, claude } = c.env
    const profile = profiles.get(param.profile)

    if (!profile) {
      throw new HTTPException(404, {
        message: notFoundMessage({
          kind: "profile",
          name: param.profile,
          available: profiles.list().map((p) => p.name),
          nextAction: "fnl profiles add <name> --path=<repo> --channel=<channel>",
        }),
      })
    }

    const exitCode = await claude.launch({
      channel: profile.channelId,
      cwd: profile.path,
      userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
      profileId: profile.id,
      options: profile.options,
      env: profile.env,
      resume: profile.resume,
    })

    process.exit(exitCode)
  },
)
