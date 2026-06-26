import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import type { JsonValue } from "@/engine/connectors/connector-adapter"
import { factory } from "@/gateway/factory"
import { zParam } from "@/gateway/routes/validator"

const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
)

const bodySchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  body: jsonValueSchema.optional(),
})

/**
 * POST /channels/:channel/connectors/:connector/call
 *
 * Generic adapter call. Used by the funnel MCP server (running in the Claude
 * Code process) to send replies/reactions/etc. without spawning a CLI
 * subprocess. Mirrors the CLI's `funnel channels <c> connectors <conn> request
 * --method=...` but with a structured JSON body and no shell.
 */
export const channelsConnectorsCallHandler = factory.createHandlers(
  zParam(z.object({ channel: z.string().min(1), connector: z.string().min(1) })),
  async (c) => {
    const param = c.req.valid("param")
    let raw: unknown = null
    try {
      raw = await c.req.json()
    } catch {
      raw = null
    }
    const parsed = bodySchema.safeParse(raw)

    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? "invalid body" })
    }

    const result = await c.var.deps.channels.call(param.channel, param.connector, {
      method: parsed.data.method,
      path: parsed.data.path,
      // Pass body through as-is; omitted body stays undefined so adapters apply
      // their own "no body" handling rather than seeing a spurious empty object.
      body: parsed.data.body,
    })

    return c.json({ ok: true, result })
  },
)
