/**
 * True when `error` is a "port already in use" failure.
 *
 * Bun's `Bun.serve` throws an error whose `code` is "EADDRINUSE" while the
 * message is only "Failed to start server. Is port N in use?" — the marker
 * lives on `code`, not in the message. Matching the message alone (as a naive
 * `.includes("EADDRINUSE")` would) misses every real Bun collision, so check
 * the code first, then fall back to the common message texts.
 */
export const isAddressInUseError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false

  const code = "code" in error ? String(Reflect.get(error, "code")) : ""

  if (code === "EADDRINUSE") return true

  const message = error.message

  return (
    message.includes("EADDRINUSE") ||
    message.includes("address already in use") ||
    message.includes("in use")
  )
}
