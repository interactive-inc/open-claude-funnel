import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/engine/yaml/yaml-render"
import { HTTPException } from "hono/http-exception"

type ConnectorIssue = {
  connector: string
  field: string
  message: string
}

const validateConnector = (
  connector: { name: string; type: string } & Record<string, unknown>,
): ConnectorIssue[] => {
  const issues: ConnectorIssue[] = []

  if (connector.type === "slack") {
    const hasBot = connector.botToken || connector.botTokenEnv

    if (!hasBot) {
      issues.push({
        connector: connector.name,
        field: "botToken",
        message: "missing botToken (xoxb-...) or botTokenEnv",
      })
    }

    const hasApp = connector.appToken || connector.appTokenEnv

    if (!hasApp) {
      issues.push({
        connector: connector.name,
        field: "appToken",
        message: "missing appToken (xapp-...) or appTokenEnv",
      })
    }

    if (
      connector.botToken &&
      typeof connector.botToken === "string" &&
      !connector.botToken.startsWith("xoxb-")
    ) {
      issues.push({
        connector: connector.name,
        field: "botToken",
        message: `botToken must start with xoxb- (got: ${connector.botToken.slice(0, 8)}...)`,
      })
    }

    if (
      connector.appToken &&
      typeof connector.appToken === "string" &&
      !connector.appToken.startsWith("xapp-")
    ) {
      issues.push({
        connector: connector.name,
        field: "appToken",
        message: `appToken must start with xapp- (got: ${connector.appToken.slice(0, 8)}...)`,
      })
    }
  }

  if (connector.type === "gh") {
    const hasToken = connector.token || connector.tokenEnv

    if (!hasToken) {
      issues.push({
        connector: connector.name,
        field: "token",
        message: "missing token or tokenEnv for GitHub connector",
      })
    }

    const hasRepo = connector.repo

    if (!hasRepo) {
      issues.push({
        connector: connector.name,
        field: "repo",
        message: "missing repo (expected owner/repo format)",
      })
    }
  }

  if (connector.type === "discord") {
    const hasToken = connector.botToken || connector.botTokenEnv

    if (!hasToken) {
      issues.push({
        connector: connector.name,
        field: "botToken",
        message: "missing botToken or botTokenEnv for Discord connector",
      })
    }
  }

  return issues
}

export const channelsValidateHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string() })),
  zValidator("query", z.object({})),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel

    const channel = funnel.channels.get(param.channel)

    if (!channel) {
      throw new HTTPException(404, { message: `channel "${param.channel}" not found` })
    }

    if (channel.connectors.length === 0) {
      return c.text(
        renderYaml({
          channel: channel.name,
          valid: false,
          issues: [{ connector: null, field: "connectors", message: "no connectors configured" }],
        }),
      )
    }

    const allIssues: ConnectorIssue[] = []

    for (const connector of channel.connectors) {
      const issues = validateConnector(
        connector as { name: string; type: string } & Record<string, unknown>,
      )

      allIssues.push(...issues)
    }

    return c.text(
      renderYaml({
        channel: channel.name,
        valid: allIssues.length === 0,
        issues: allIssues,
      }),
    )
  },
)
