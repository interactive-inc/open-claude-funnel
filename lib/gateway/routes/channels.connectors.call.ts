import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/gateway/factory"
import { zParam } from "@/gateway/routes/validator"

const bodySchema = z.object({
  method: z.string().min(1),
  path: z.string().min(1),
  body: z.unknown().optional(),
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
    const raw = await c.req.json().catch(() => null)
    const parsed = bodySchema.safeParse(raw)

    if (!parsed.success) {
      throw new HTTPException(400, { message: parsed.error.issues[0]?.message ?? "invalid body" })
    }

    const result = await c.var.deps.channels.call(param.channel, param.connector, {
      method: parsed.data.method,
      path: parsed.data.path,
      body: parsed.data.body ?? {},
    })

    return c.json({ ok: true, result })
  },
)
