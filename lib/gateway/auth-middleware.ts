import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { Env } from "@/gateway/factory";

type Deps = {
  expected: string;
};

/**
 * Verifies `Authorization: Bearer <token>` against the daemon's gateway token.
 * Mounted on the routes that mutate listener state or expose detailed status.
 * `/health` is intentionally left unauthenticated so the daemon manager can
 * probe liveness without needing the token.
 */
export const requireBearerToken = (deps: Deps): MiddlewareHandler<Env> => {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const presented = match?.[1] ?? "";

    if (!constantTimeEqual(presented, deps.expected)) {
      return c.text("unauthorized", 401);
    }

    return await next();
  };
};

export const constantTimeEqual = (a: string, b: string): boolean => {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  const maxLen = Math.max(bufA.length, bufB.length, 1);
  const padA = Buffer.alloc(maxLen);
  const padB = Buffer.alloc(maxLen);

  bufA.copy(padA);
  bufB.copy(padB);

  // timingSafeEqual on equal-length padded buffers, then AND with length match
  // so a length-only probe still requires the full comparison time.
  const equal = timingSafeEqual(padA, padB);

  return equal && bufA.length === bufB.length;
};
