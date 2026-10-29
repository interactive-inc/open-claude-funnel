import { expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import { invokeCallback } from "@/invoke-callback"

for (const realm of ["current", "other"] as const) {
  for (const property of ["then", "catch"] as const) {
    for (const behavior of ["hidden", "throwing"] as const) {
      for (const stage of ["callback", "reporter"] as const) {
        test(`${stage} observes ${realm} promises with ${behavior} ${property}`, async () => {
          const deferred: { promise: Promise<unknown>; reject: (error: unknown) => void } =
            realm === "current"
              ? Promise.withResolvers<unknown>()
              : runInNewContext("Promise.withResolvers()")
          let reads = 0
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied promise with overridden methods.
          Object.defineProperty(deferred.promise, property, {
            get() {
              reads++
              if (behavior === "throwing") throw new Error("method unavailable")
              return undefined
            },
          })
          const original = new Error("original rejection")
          const trigger = new Error("callback failure")
          const reported: unknown[] = []
          let called = false
          invokeCallback(
            () => {
              called = true
              if (stage === "reporter") throw trigger
              return deferred.promise
            },
            (error) => {
              reported.push(error)
              if (stage === "reporter") return deferred.promise
            },
          )
          expect(called).toBe(true)
          deferred.reject(original)
          await Bun.sleep(0)
          expect(reads).toBe(0)
          expect(reported).toEqual([stage === "callback" ? original : trigger])
        })
      }
    }
  }
}

test("ordinary thenables preserve their receiver and adopt nested rejections", async () => {
  let reads = 0
  const failure = new Error("nested rejection")
  const reported: unknown[] = []
  const value = {
    // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
    get then() {
      reads++
      return function (this: unknown, resolve: (result: unknown) => void) {
        expect(this).toBe(value)
        resolve(Promise.reject(failure))
      }
    },
  }
  invokeCallback(
    () => value,
    (error) => reported.push(error),
  )
  await Bun.sleep(0)
  expect(reads).toBe(1)
  expect(reported).toEqual([failure])
})

test("synchronous callback failures are reported synchronously and reporter failures stay contained", () => {
  const failure = new Error("callback failure")
  let reported: unknown
  expect(() =>
    invokeCallback(
      () => {
        throw failure
      },
      (error) => {
        reported = error
        throw new Error("reporter failure")
      },
    ),
  ).not.toThrow()
  expect(reported).toBe(failure)
})
