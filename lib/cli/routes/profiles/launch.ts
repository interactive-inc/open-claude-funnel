import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { queryToCliArgs } from "@/cli/router/query-to-cli-args"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/profiles/launch.help"

const RESERVED_KEYS: string[] = []

export const profilesLaunchHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}).passthrough(), help),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const profile = funnel.profiles.get(param.name)

    if (!profile) throw new HTTPException(404, { message: `profile "${param.name}" not found` })

    const exitCode = await funnel.claude.launch({
      channel: profile.channelId,
      cwd: profile.path,
      subAgent: profile.subAgent,
      userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
      profileName: profile.name,
    })

    process.exit(exitCode)
  },
)
