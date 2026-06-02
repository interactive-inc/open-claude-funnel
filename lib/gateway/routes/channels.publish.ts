import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { factory } from "@/gateway/factory"
import { publishRequestSchema } from "@/gateway/publish-schema"
import type { PublishResponse } from "@/gateway/publish-schema"
import { zParam } from "@/gateway/routes/validator"

/**
 * POST /channels/:channel/publish
 *
 * Inject arbitrary content into a channel. Mirrors the connector-driven `notify`
 * path: events go through `broadcaster.broadcast` + `eventLog.record`, so
 * subscribers see them exactly as if a listener had produced them.
 *
 * Body validation is Zod-shared with the client (`publishRequestSchema`); the
 * response (`publishResponseSchema`) carries the assigned offset so callers can
 * correlate with the persistent event store.
 */
export const channelsPublishHandler = factory.createHandlers(
  zParam(z.object({ channel: z.string().min(1) })),
  zValidator("json", publishRequestSchema, (result, c) => {
    if (result.success) return

    const issue = result.error.issues[0]
    const reason = issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid body"

    return c.json({ ok: false, reason }, 400)
  }),
  (c) => {
    const param = c.req.valid("param")
    const body = c.req.valid("json")

    const meta = body.target ? { ...body.meta, target: body.target } : body.meta

    const event = c.var.deps.emit({
      channel: param.channel,
      connector: body.connector,
      content: body.content,
      meta,
    })

    const response: PublishResponse = { ok: true, offset: event.offset }

    return c.json(response)
  },
)
