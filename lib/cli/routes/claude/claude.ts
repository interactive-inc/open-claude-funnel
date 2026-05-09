import { z } from "zod"
import { factory } from "@/cli/factory"
import { queryToCliArgs } from "@/cli/router/query-to-cli-args"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/claude/claude.help"

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
    help,
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
      if (query.profile) return c.text(`profile "${query.profile}" not found`, 404)
      return c.text(help)
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
