import { jsonBodyDepth } from "@/gateway/routes/json-body-depth"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import type { JsonValue } from "@/engine/connectors/connector-adapter"
import { factory } from "@/gateway/factory"
import { zParam } from "@/gateway/routes/validator"
import { normalizeError } from "@/engine/error/error-message-of"

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

/** Forward an authenticated subscriber call to the external connector. */
export const channelsConnectorsCallHandler = factory.createHandlers(
  zParam(z.object({ channel: z.string().min(1), connector: z.string().min(1) })),
  jsonBodyDepth,
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

    c.var.deps.assertActive()
    const result = await c.var.deps.channels
      .call(param.channel, param.connector, {
        method: parsed.data.method,
        path: parsed.data.path,
        // Pass body through as-is; omitted body stays undefined so adapters apply
        // their own "no body" handling rather than seeing a spurious empty object.
        body: parsed.data.body,
        signal: c.var.deps.callSignal
          ? AbortSignal.any([c.var.deps.callSignal, c.req.raw.signal])
          : c.req.raw.signal,
      })
      .catch((error: unknown) => {
        throw normalizeError(error)
      })

    return c.json({ ok: true, result })
  },
)
