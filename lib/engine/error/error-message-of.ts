/**
 * Normalize an unknown thrown value into a loggable message string.
 */
export const errorMessageOf = (error: unknown): string => {
  return error instanceof Error ? error.message : String(error)
}
