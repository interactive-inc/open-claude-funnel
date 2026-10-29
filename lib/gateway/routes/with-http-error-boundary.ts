import { normalizeError } from "@/engine/error/error-message-of"

/** Normalize host failures before the HTTP framework inspects thrown values. */
export async function withHttpErrorBoundary<T>(callback: () => T | Promise<T>): Promise<T> {
  try {
    return await callback()
  } catch (error) {
    throw normalizeError(error)
  }
}
