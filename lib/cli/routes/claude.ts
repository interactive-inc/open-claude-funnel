import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { queryToCliArgs } from "@/cli/router/query-to-cli-args"
import { zValidator } from "@/cli/router/validator"

export const claudeHelp = `funnel claude — launch Claude Code

usage:
  funnel claude                          launch the default profile (first in the list)
  funnel claude -p <name>                launch a named profile
  funnel claude --profile <name>         (long form)
  funnel claude --channel <name>         raw launch (no profile, cwd = current dir)

options:
  -p, --profile      profile name to launch
  --channel          channel name (raw launch, ignored when --profile is given)

Any other arguments are forwarded to the claude CLI.
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

    if (query.channel && !query.profile) {
      const exitCode = await funnel.claude.launch({
        channel: query.channel,
        userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
      })

      process.exit(exitCode)
    }

    const profile = query.profile
      ? funnel.profiles.get(query.profile)
      : funnel.profiles.getDefault()

    if (!profile) {
      if (query.profile) {
        throw new HTTPException(404, { message: `profile "${query.profile}" not found` })
      }
      return c.text(claudeHelp)
    }

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
