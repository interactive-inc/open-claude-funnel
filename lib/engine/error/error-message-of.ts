/**
 * Normalize an unknown thrown value into a loggable message string.
 */
export const errorMessageOf = (error: unknown): string => {
  try {
    if (error instanceof Error) {
      const message = error.message
      if (typeof message === "string") return message
    }
    return String(error)
  } catch {
    return "Unprintable thrown value"
  }
}

/** Preserve real error identity and safely wrap other thrown values. */
export const normalizeError = (error: unknown): Error => {
  try {
    if (error instanceof Error) return error
  } catch {}
  return new Error(errorMessageOf(error))
}
