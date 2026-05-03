import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/connectors/set.help"

const SLACK_FIELDS = ["bot-token", "app-token"] as const
const GH_FIELDS = ["poll-interval"] as const
const DISCORD_FIELDS = ["bot-token"] as const

const rejectExtraneous = (
  query: Record<string, string | undefined>,
  allowed: ReadonlyArray<string>,
  type: string,
): void => {
  for (const key of ["bot-token", "app-token", "poll-interval"]) {
    if (query[key] === undefined) continue
    if (allowed.includes(key)) continue

    throw new HTTPException(400, {
      message: `connector type "${type}" does not accept --${key}`,
    })
  }
}

export const connectorsSetHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      "bot-token": z.string().optional(),
      "app-token": z.string().optional(),
      "poll-interval": z.string().optional(),
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const current = funnel.connectors.get(param.name)

    if (!current) {
      throw new HTTPException(404, { message: `connector "${param.name}" not found` })
    }

    if (current.type === "slack") {
      rejectExtraneous(query, SLACK_FIELDS, "slack")
      funnel.connectors.updateSlack(param.name, {
        botToken: query["bot-token"],
        appToken: query["app-token"],
      })
    } else if (current.type === "gh") {
      rejectExtraneous(query, GH_FIELDS, "gh")
      funnel.connectors.updateGh(param.name, {
        pollInterval: query["poll-interval"] ? Number(query["poll-interval"]) : undefined,
      })
    } else if (current.type === "discord") {
      rejectExtraneous(query, DISCORD_FIELDS, "discord")
      funnel.connectors.updateDiscord(param.name, {
        botToken: query["bot-token"],
      })
    } else {
      throw new HTTPException(400, {
        message: `schedule connectors have no top-level fields — use schedules add/remove`,
      })
    }

    return c.text(`updated connector "${param.name}"`)
  },
)
