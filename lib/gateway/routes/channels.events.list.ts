import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/gateway/factory"
import { zParam } from "@/gateway/routes/validator"

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

const querySchema = z.object({
  since: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).optional(),
  connector: z.string().min(1).optional(),
})

export type ChannelEventListItem = {
  offset: number
  content: string
  meta: Record<string, string>
}

export type ChannelEventListResponse = {
  ok: true
  channel: string
  events: ChannelEventListItem[]
}

/**
 * GET /channels/:channel/events
 *
 * Pull-style event lookup for MCP subscribers that want to verify they
 * haven't missed a push notification. Backed by the SQLite event store so
 * results survive daemon restarts. Filters by channel id (resolved from
 * `:channel`, which accepts either id or name) and optionally by connector
 * name; `since` is a broadcaster offset and the response is sorted ascending.
 *
 * This is the gateway side of the `funnel_events` MCP tool: Claude calls the
 * tool at the end of an event-handling turn and the tool issues this request.
 */
export const channelsEventsListHandler = factory.createHandlers(
  zParam(z.object({ channel: z.string().min(1) })),
  async (c) => {
    const param = c.req.valid("param")
    const query = querySchema.safeParse({
      since: c.req.query("since"),
      limit: c.req.query("limit"),
      connector: c.req.query("connector"),
    })

    if (!query.success) {
      throw new HTTPException(400, {
        message: query.error.issues[0]?.message ?? "invalid query",
      })
    }

    const channels = c.var.deps.channels.list()
    const channel = channels.find((ch) => ch.id === param.channel || ch.name === param.channel)

    if (!channel) {
      throw new HTTPException(404, { message: `channel not found: ${param.channel}` })
    }

    const connectorName = query.data.connector
    const connectorId = connectorName
      ? (channel.connectors.find((conn) => conn.name === connectorName)?.id ?? null)
      : undefined

    if (connectorName && connectorId === null) {
      throw new HTTPException(404, {
        message: `connector not found in channel: ${connectorName}`,
      })
    }

    const events = c.var.deps.eventStore.loadForChannel({
      channelId: channel.id,
      ...(connectorId ? { connectorId } : {}),
      ...(query.data.since !== undefined ? { sinceSeq: query.data.since } : {}),
      limit: query.data.limit ?? DEFAULT_LIMIT,
    })

    const response: ChannelEventListResponse = {
      ok: true,
      channel: channel.name,
      events: events.map((event) => ({
        offset: event.offset,
        content: event.content,
        meta: event.meta ?? {},
      })),
    }

    return c.json(response)
  },
)
