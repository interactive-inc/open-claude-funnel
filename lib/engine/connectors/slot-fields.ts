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
  literalKey: string,
  envKey: string,
  fields: Record<string, unknown>,
  current: Record<string, unknown>,
): Record<string, string> => {
  const literal = fields[literalKey]

  if (typeof literal === "string") return { [literalKey]: literal }

  const envVar = fields[envKey]

  if (typeof envVar === "string") return { [envKey]: envVar }

  const result: Record<string, string> = {}
  const currentLiteral = current[literalKey]
  const currentEnv = current[envKey]

  if (typeof currentLiteral === "string") result[literalKey] = currentLiteral
  if (typeof currentEnv === "string") result[envKey] = currentEnv

  return result
}
