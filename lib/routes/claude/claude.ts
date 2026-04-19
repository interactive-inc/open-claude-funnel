import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/factory"
import { queryToCliArgs } from "@/modules/router/query-to-cli-args"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/claude/claude.help"

const RESERVED_KEYS = ["profile", "channel", "repo", "sub-agent", "env-file"]

const DEFAULT_PROFILE_NAME = "default"

export const claudeHandler = factory.createHandlers(
  zValidator(
    "query",
    z
      .object({
        profile: z.string().optional(),
        channel: z.string().optional(),
        repo: z.string().optional(),
        "sub-agent": z.string().optional(),
        "env-file": z.string().optional(),
      })
      .passthrough(),
    help,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    if (query.profile) {
      const profile = funnel.profiles.get(query.profile)

      if (!profile) {
        throw new HTTPException(404, { message: `profile "${query.profile}" not found` })
      }

      const exitCode = await funnel.claude.launch({
        channel: query.channel ?? profile.channel,
        repo: query.repo ?? profile.repo,
        subAgent: query["sub-agent"] ?? profile.subAgent,
        envFiles: query["env-file"] ? [query["env-file"]] : profile.envFiles,
        userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
        profileName: profile.name,
      })

      process.exit(exitCode)
    }

    if (query.channel) {
      const exitCode = await funnel.claude.launch({
        channel: query.channel,
        repo: query.repo,
        subAgent: query["sub-agent"],
        envFiles: query["env-file"] ? [query["env-file"]] : undefined,
        userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
      })

      process.exit(exitCode)
    }

    const defaultProfile = funnel.profiles.get(DEFAULT_PROFILE_NAME)

    if (!defaultProfile) return c.text(help)

    const exitCode = await funnel.claude.launch({
      channel: defaultProfile.channel,
      repo: query.repo ?? defaultProfile.repo,
      subAgent: query["sub-agent"] ?? defaultProfile.subAgent,
      envFiles: query["env-file"] ? [query["env-file"]] : defaultProfile.envFiles,
      userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
      profileName: defaultProfile.name,
    })

    process.exit(exitCode)
  },
)
