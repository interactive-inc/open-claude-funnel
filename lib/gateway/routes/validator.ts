import { zValidator } from "@hono/zod-validator"
import type { ZodType } from "zod"

/**
 * Path-param validator for gateway routes. On failure it answers with the same
 * `{ ok: false, reason }` shape the listener routes already use, so
 * `FunnelListenersClient` can surface the message without special-casing.
 */
export const zParam = <T extends ZodType>(schema: T) =>
  zValidator("param", schema, (result, c) => {
    if (result.success) return

    const issue = result.error.issues[0]
    const reason = issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid request"

    return c.json({ ok: false, reason }, 400)
  })

/** Query-string validator with the same failure envelope as `zParam`. */
export const zQuery = <T extends ZodType>(schema: T) =>
  zValidator("query", schema, (result, c) => {
    if (result.success) return

    const issue = result.error.issues[0]
    const reason = issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid query"

    return c.json({ ok: false, reason }, 400)
  })
