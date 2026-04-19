import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/factory"
import { queryToCliArgs } from "@/modules/router/query-to-cli-args"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/agents/launch.help"

const RESERVED_KEYS = ["channel", "repo", "sub-agent", "env-file"]

export const agentsLaunchHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}).passthrough(), help),
  async (c) => {
    const param = c.req.valid("param")
    const funnel = c.var.funnel
    const agent = funnel.agents.get(param.name)

    if (!agent) throw new HTTPException(404, { message: `agent "${param.name}" not found` })

    const overrideChannel = c.req.query("channel")
    const overrideRepo = c.req.query("repo")
    const overrideSubAgent = c.req.query("sub-agent")
    const overrideEnvFile = c.req.query("env-file")

    const exitCode = await funnel.claude.launch({
      channel: overrideChannel ?? agent.channel,
      repo: overrideRepo ?? agent.repo,
      subAgent: overrideSubAgent ?? agent.subAgent,
      envFiles: overrideEnvFile ? [overrideEnvFile] : agent.envFiles,
      userArgs: queryToCliArgs(c.req.url, RESERVED_KEYS),
    })

    process.exit(exitCode)
  },
)
