import { factory } from "@/gateway/factory"
import { hasSafeJsonDepth } from "@/has-safe-json-depth"

/** Check cached text before JSON parsing or recursive schema evaluation can exhaust the stack. */
export const jsonBodyDepth = factory.createMiddleware(async (c, next) => {
  let body: string
  try {
    body = await c.req.text()
  } catch {
    return c.json({ ok: false, reason: "invalid body" }, 400)
  }
  if (!hasSafeJsonDepth(body))
    return c.json({ ok: false, reason: "JSON nesting exceeds 128 levels" }, 400)
  await next()
})
