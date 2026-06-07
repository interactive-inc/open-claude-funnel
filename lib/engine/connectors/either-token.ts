/**
 * A single connector token slot is supplied one of two non-empty ways, which
 * are mutually exclusive, or left empty:
 *
 *   - the literal secret (`botToken: "xoxb-…"`)
 *   - the *name* of an env var holding it (`botTokenEnv: "SLACK_BOT_TOKEN"`)
 *   - neither — left for the CLI / TTY prompt to fill in at launch
 *
 * `EitherToken<"botToken", "botTokenEnv">` makes "both set at once" a compile
 * error while still allowing "neither". Compose multiple slots with `&` (a slack
 * connector intersects a bot slot and an app slot); the intersection keeps each
 * slot independently exclusive without enumerating the cross-product.
 *
 * To build a value, use the slot helpers below (`botTokenSlot` etc.). They take
 * a resolved `{ literal, env }` and return the exclusive shape. A generic
 * builder can't: TS can't prove a `Record<Env, …>` omits the `Literal` key when
 * both are free type params, so each helper fixes concrete key names instead.
 */
export type EitherToken<Literal extends string, Env extends string> =
  | (Partial<Record<Literal, string>> & Partial<Record<Env, never>>)
  | (Partial<Record<Literal, never>> & Partial<Record<Env, string>>)

/** A resolved slot: at most one side set. `botTokenSlot` etc. project it onto keys. */
export type ResolvedSlot = { literal: string | undefined; env: string | undefined }

export function botTokenSlot(slot: ResolvedSlot): EitherToken<"botToken", "botTokenEnv"> {
  if (slot.env !== undefined) return { botTokenEnv: slot.env }
  if (slot.literal !== undefined) return { botToken: slot.literal }

  return {}
}

export function appTokenSlot(slot: ResolvedSlot): EitherToken<"appToken", "appTokenEnv"> {
  if (slot.env !== undefined) return { appTokenEnv: slot.env }
  if (slot.literal !== undefined) return { appToken: slot.literal }

  return {}
}
