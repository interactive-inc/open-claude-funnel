import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { queryToCliArgs } from "@/cli/router/query-to-cli-args"
import { zValidator } from "@/cli/router/validator"

export const claudeHelp = `funnel claude — launch Claude Code

usage:
  funnel claude                          launch the first channel from funnel.json, or the default profile
  funnel claude --channel <name>         with funnel.json: select that channel; without: raw launch
  funnel claude -p <name>                launch a named profile
  funnel claude --profile <name>         (long form)
  funnel claude [...]                    any other argument is forwarded to the claude CLI

resolution order:
  1. --help                              print this help
  2. --profile <name>                    named profile (ignores funnel.json)
  3. ./funnel.json in the current directory + --channel selects (or first wins)
  4. --channel <name> with no funnel.json → raw launch using an existing settings.json channel
  5. the default profile (first entry in fnl profiles)

funnel-specific options (everything else passes through to claude verbatim):
  -p, --profile      profile name to launch
  --channel          channel name (selects from funnel.json, or raw-launches if no funnel.json)
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
      const picked =
        query.channel !== undefined
          ? local.channels.find((c) => c.name === query.channel)
          : local.channels[0]

      if (!picked) {
        throw new HTTPException(404, {
          message: query.channel
            ? `channel "${query.channel}" is not declared in funnel.json`
            : `funnel.json declares no channels`,
        })
      }

      await funnel.localConfigSync.ensure(picked, cwd)

      const exitCode = await funnel.claude.launch({
        channel: picked.name,
        cwd,
        userArgs: [...(local.options ?? []), ...(picked.options ?? []), ...userArgs],
        extraEnv: { ...(local.env ?? {}), ...(picked.env ?? {}) },
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
