import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/factory"
import { queryToCliArgs } from "@/modules/router/query-to-cli-args"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/profiles/launch.help"

const RESERVED_KEYS = ["channel", "repo", "sub-agent", "env-file"]

export const profilesLaunchHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}).passthrough(), help),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const profile = funnel.profiles.get(param.name)

    if (!profile) throw new HTTPException(404, { message: `profile "${param.name}" not found` })

    const overrideChannel = c.req.query("channel")
    const overrideRepo = c.req.query("repo")
    const overrideSubAgent = c.req.query("sub-agent")
    const overrideEnvFile = c.req.query("env-file")

    const exitCode = await funnel.claude.launch({
      channel: overrideChannel ?? profile.channel,
      repo: overrideRepo ?? profile.repo,
      subAgent: overrideSubAgent ?? profile.subAgent,
      envFiles: overrideEnvFile ? [overrideEnvFile] : profile.envFiles,
      userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
      profileName: profile.name,
    })

    process.exit(exitCode)
  },
)
