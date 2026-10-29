import { errorMessageOf } from "@/engine/error/error-message-of"

/** Preserve the caller's known HTTP status even when the error body cannot be read. */
export async function readHttpErrorDetail(response: { text(): Promise<string> }): Promise<string> {
  try {
    return await response.text()
  } catch (error) {
    return `response body read failed: ${errorMessageOf(error)}`
  }
}
