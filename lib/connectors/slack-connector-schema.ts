import { z } from "zod"

/**
 * A slack connector resolves its tokens one of two ways, set at sync time:
 *
 *   - literal: `botToken` / `appToken` hold the real `xoxb-`/`xapp-` secret
 *     (set by a `fnl channels` command or a TTY prompt at launch).
 *   - by reference: `botTokenEnv` / `appTokenEnv` hold the *name* of an env var.
 *     The secret never lands in settings.json; the listener resolves it from
 *     `process.env` at start. This form is only set through the engine API
 *     (`new Funnel(...)`) — funnel.json and the `fnl` CLI produce literals.
 *
 * Both are optional at the schema level (a discriminated-union member can't
 * carry a cross-field refine); the listener requires exactly one resolved
 * token per slot and errors loudly otherwise.
 */
export const slackConnectorSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.literal("slack"),
  botToken: z.string().startsWith("xoxb-").optional(),
  appToken: z.string().startsWith("xapp-").optional(),
  /** Name of the env var holding the bot token, resolved at listener start. */
  botTokenEnv: z.string().optional(),
  /** Name of the env var holding the app token, resolved at listener start. */
  appTokenEnv: z.string().optional(),
  minify: z.boolean().default(true),
  createdAt: z.string().datetime().optional(),
  updatedAt: z.string().datetime().optional(),
})

export type SlackConnectorConfig = z.infer<typeof slackConnectorSchema>
