import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

const requestHelp = `funnel channels <channel> connectors <connector> request — call a connector's outbound API

usage: funnel channels <channel> connectors <connector> request --method=<api.method> [--key=value ...]`

export const channelsConnectorsRequestHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator(
    "query",
    z
      .object({
        method: z.string(),
      })
      .passthrough(),
    requestHelp,
  ),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel

    const passthrough: Record<string, string> = {}

    for (const [k, v] of new URL(c.req.url).searchParams) {
      if (k === "method") continue
      passthrough[k] = v
    }

    const response = await funnel.channels.call(param.channel, param.connector, {
      method: query.method,
      path: query.method,
      body: passthrough,
    })

    return c.text(typeof response === "string" ? response : JSON.stringify(response, null, 2))
  },
)
