import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { queryToCliArgs } from "@/cli/router/query-to-cli-args"
import { zValidator } from "@/cli/router/validator"

export const claudeHelp = `funnel claude — launch Claude Code

usage:
  funnel claude                          launch using funnel.json in cwd, or the default profile
  funnel claude -p <name>                launch a named profile
  funnel claude --profile <name>         (long form)
  funnel claude --channel <name>         raw launch (no profile, cwd = current dir)
  funnel claude [...]                    any other argument is forwarded to the claude CLI

resolution order when no --profile / --channel is given:
  1. ./funnel.json in the current directory
  2. the default profile (first entry in fnl profiles)

funnel-specific options (everything else passes through to claude verbatim):
  -p, --profile      profile name to launch
  --channel          channel name (raw launch, ignored when --profile is given)
  -h, --help         show this help

Positional args, unknown short flags (e.g. -c, -r), and claude's own flags
(--agent, --resume, --model, --print, --output-format ...) are all forwarded.
On launch the FUNNEL_CHANNEL_ID env var is set and MCP connects to the gateway.`

const RESERVED_KEYS = ["profile", "channel"]

export const claudeHandler = factory.createHandlers(
  zValidator(
    "query",
    z
      .object({
        profile: z.string().optional(),
        channel: z.string().optional(),
      })
      .passthrough(),
    claudeHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel
    const userArgs = queryToCliArgs(c.req.url, RESERVED_KEYS)

    if (query.channel && !query.profile) {
      const exitCode = await funnel.claude.launch({
        channel: query.channel,
        userArgs,
      })

      process.exit(exitCode)
    }

    if (query.profile) {
      const profile = funnel.profiles.get(query.profile)

      if (!profile) {
        throw new HTTPException(404, { message: `profile "${query.profile}" not found` })
      }

      const exitCode = await funnel.claude.launch({
        channel: profile.channelId,
        cwd: profile.path,
        subAgent: profile.subAgent,
        userArgs,
        profileName: profile.name,
        brief: profile.brief,
      })

      process.exit(exitCode)
    }

    const cwd = process.cwd()
    const local = funnel.localConfig.read(cwd)

    if (local) {
      await funnel.localConfigSync.ensure(local, cwd)

      const exitCode = await funnel.claude.launch({
        channel: local.channel,
        cwd,
        userArgs: [...(local.options ?? []), ...userArgs],
        extraEnv: local.env,
      })

      process.exit(exitCode)
    }

    const defaultProfile = funnel.profiles.getDefault()

    if (!defaultProfile) {
      return c.text(claudeHelp)
    }

    const exitCode = await funnel.claude.launch({
      channel: defaultProfile.channelId,
      cwd: defaultProfile.path,
      subAgent: defaultProfile.subAgent,
      userArgs,
      profileName: defaultProfile.name,
      brief: defaultProfile.brief,
    })

    process.exit(exitCode)
  },
)
