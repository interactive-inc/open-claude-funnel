import type { MiddlewareHandler } from "hono"

export function helpGuard(help: string): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.query("help")) {
      return c.text(help)
    }

    await next()
  }
}
