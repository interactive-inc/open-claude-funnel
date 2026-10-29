import { readRequestText } from "@/gateway/routes/read-request-text"
import { factory } from "@/gateway/factory"
import { hasSafeJsonDepth } from "@/has-safe-json-depth"

/** Check cached text before JSON parsing or recursive schema evaluation can exhaust the stack. */
export const jsonBodyDepth = factory.createMiddleware(async (c, next) => {
  const request = c.req.raw
  const signal = c.var.deps.callSignal
    ? AbortSignal.any([request.signal, c.var.deps.callSignal])
    : request.signal
  let body: string
  try {
    signal.throwIfAborted()
    if (request.bodyUsed) body = await c.req.text()
    else {
      body = await readRequestText(request, signal)
      // Rebuild the consumed body through the public Request boundary. Hono
      // can then cache it normally for the following JSON validators.
      c.req.raw = new Request(request, { method: request.method, body })
    }
    signal.throwIfAborted()
  } catch {
    if (c.var.deps.callSignal?.aborted)
      return c.json({ ok: false, reason: "gateway is stopped" }, 503)
    return c.json({ ok: false, reason: "invalid body" }, 400)
  }
  if (!hasSafeJsonDepth(body))
    return c.json({ ok: false, reason: "JSON nesting exceeds 128 levels" }, 400)
  await next()
})
