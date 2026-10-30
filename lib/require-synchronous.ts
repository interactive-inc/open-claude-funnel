import { invokeCallback } from "@/invoke-callback"
import { isPromise } from "node:util/types"

const promiseThen = Promise.prototype.then

/** Reject async results while observing their failure through one captured then method. */
export function requireSynchronous<T>(
  value: T,
  message: string,
  onError?: (error: unknown) => unknown,
): T {
  if (value !== null && (typeof value === "object" || typeof value === "function")) {
    const then = isPromise(value) ? promiseThen : Reflect.get(value, "then")
    if (typeof then === "function") {
      invokeCallback(
        () =>
          new Promise((resolve, reject) => {
            const returned = Reflect.apply(then, value, [resolve, reject])
            // Host then methods can fail through a separate native promise,
            // even after settling the bridge. Do not re-assimilate returned thenables.
            if (returned !== value && isPromise(returned)) invokeCallback(() => returned, onError)
          }),
        onError,
      )
      throw new Error(message)
    }
  }
  return value
}
