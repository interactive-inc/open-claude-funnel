import { z } from "zod"
import { factory } from "@/factory"
import { queryToCliArgs } from "@/modules/router/query-to-cli-args"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/claude/claude.help"

const RESERVED_KEYS = ["channel", "repo", "sub-agent", "env-file"]

export const claudeHandler = factory.createHandlers(
  zValidator(
    "query",
    z
      .object({
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

    if (!query.channel) return c.text(help)

    const funnel = c.var.funnel

    const exitCode = await funnel.claude.launch({
      channel: query.channel,
      repo: query.repo,
      subAgent: query["sub-agent"],
      envFiles: query["env-file"] ? [query["env-file"]] : undefined,
      userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
    })

    process.exit(exitCode)
  },
)
