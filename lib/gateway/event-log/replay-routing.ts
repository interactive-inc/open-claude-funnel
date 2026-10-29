/** Preserve canonical routing identities when projecting records into replay metadata. */
export function replayRoutingMetadata(
  channelId: string | null,
  connectorId: string | null,
  meta: Record<string, string> | null | undefined,
): Record<string, string> | undefined {
  let copied = meta ? { ...meta } : undefined
  for (const [key, id] of [
    ["channelId", channelId],
    ["connectorId", connectorId],
  ] as const) {
    if (id !== null && (typeof id !== "string" || id === ""))
      throw new Error("replay identifier must be a non-empty string or null")
    if (copied && Object.hasOwn(copied, key) && (id === null || copied[key] !== id))
      throw new Error("replay routing metadata conflicts with stored identity")
    if (id !== null) {
      copied ??= {}
      copied[key] = id
    }
  }
  return copied
}
