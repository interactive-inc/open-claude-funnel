import { z } from "zod"

/**
 * Resolves one token slot (e.g. botToken/botTokenEnv) for a connector update.
 * The literal and the env-ref form are mutually exclusive: if `fields` supplies
 * either, that form wins and the other key is omitted entirely; if it supplies
 * neither, the connector's current slot is carried over unchanged. Returns a
 * partial object spread into the rebuilt connector, so an omitted key is truly
 * absent rather than set to undefined — switching a slot from literal to ref
 * drops the stale literal instead of leaving both behind.
 */
export const slotFields = (
  slot: { literalKey: string; envKey: string },
  fields: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, string> => {
  const supplied = z
    .object({
      [slot.literalKey]: z.string().optional(),
      [slot.envKey]: z.string().optional(),
    })
    .parse(fields)
  const literal = supplied[slot.literalKey]

  if (literal !== undefined) return { [slot.literalKey]: literal }

  const envVar = supplied[slot.envKey]

  if (envVar !== undefined) return { [slot.envKey]: envVar }

  const result: Record<string, string> = {}
  const currentLiteral = current[slot.literalKey]
  const currentEnv = current[slot.envKey]

  if (typeof currentLiteral === "string") result[slot.literalKey] = currentLiteral
  if (typeof currentEnv === "string") result[slot.envKey] = currentEnv

  return result
}
