import { z } from "zod"

/**
 * Shared schema for `POST /channels/:channel/publish` — used by both the
 * gateway route handler (input validation) and the CLI / programmable client
 * (request shape). The route resolves `channel` from the path; this body
 * covers everything else.
 */
export const publishRequestSchema = z.object({
  content: z.string().min(1),
  meta: z.record(z.string(), z.string()).optional(),
  connector: z.string().min(1).optional(),
  /**
   * Address the event to a single subscriber. When set, only the WS client that
   * declared this id at upgrade time (`?id=<subscriberId>`) receives it among the
   * channel's regular subscribers; tap=all observers still see it. Omit for the
   * default fanout. The route surfaces it to subscribers as `meta.target`.
   */
  target: z.string().min(1).optional(),
})

export type PublishRequest = z.infer<typeof publishRequestSchema>

export const publishResponseSchema = z.object({
  ok: z.literal(true),
  offset: z.number().int().nonnegative(),
})

export type PublishResponse = z.infer<typeof publishResponseSchema>

export type PublishResult =
  | { state: "ok"; offset: number }
  | { state: "offline" }
  | { state: "error"; reason: string }
