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
