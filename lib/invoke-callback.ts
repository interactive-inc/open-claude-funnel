import { isPromise } from "node:util/types"

const promiseThen = Promise.prototype.then

function observe(value: unknown, onError: (error: unknown) => void): void {
  if (value !== undefined)
    Reflect.apply(promiseThen, isPromise(value) ? value : Promise.resolve(value), [
      undefined,
      onError,
    ])
}

/** Observe host callbacks and thenables without allowing a failing error sink to escape. */
export function invokeCallback(
  callback: () => unknown,
  onError?: (error: unknown) => unknown,
): void {
  const report = (error: unknown): void => {
    try {
      observe(onError?.(error), () => {})
    } catch {}
  }
  try {
    const returned = callback()
    observe(returned, report)
  } catch (error) {
    report(error)
  }
}
