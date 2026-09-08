import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { connectorFieldsSchema } from "@/cli/connector-fields"
import { factory } from "@/cli/factory"
import { notFoundMessage } from "@/cli/routes/not-found-message"
import { zValidator } from "@/cli/router/validator"

export const channelsConnectorsSetHandler = factory.createHandlers(
  zValidator("param", z.object({ channel: z.string(), connector: z.string() })),
  zValidator("query", connectorFieldsSchema),
  async (c) => {
    const param = c.req.valid("param")
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const existing = funnel.channels.getConnector(param.channel, param.connector)

    if (!existing) {
      throw new HTTPException(404, {
        message: notFoundMessage({
          kind: "connector",
          name: param.connector,
          available: (funnel.channels.get(param.channel)?.connectors ?? []).map(
            (conn) => conn.name,
          ),
          nextAction: `fnl channels ${param.channel} connectors add <name> --type=slack|gh|discord|schedule ...`,
        }),
      })
    }

    funnel.channels.updateConnector(param.channel, param.connector, query)

    await funnel.listeners.restart(param.channel, param.connector)

    return c.text(`updated connector "${param.connector}" in channel "${param.channel}"`)
  },
)
