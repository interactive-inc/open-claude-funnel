import { invokeCallback } from "@/invoke-callback"

/** Reject async results while observing their failure through one captured then method. */
export function requireSynchronous<T>(
  value: T,
  message: string,
  onError?: (error: unknown) => unknown,
): T {
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    const then = Reflect.get(value, "then")
    if (typeof then === "function") {
      invokeCallback(
        () =>
          new Promise((resolve, reject) => {
            Reflect.apply(then, value, [resolve, reject])
          }),
        onError,
      )
      throw new Error(message)
    }
  }
  return value
}
