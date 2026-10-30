import { expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import { requireSynchronous } from "@/require-synchronous"

for (const realm of ["current", "other"] as const) {
  for (const property of ["hidden", "throwing"] as const) {
    test(`${realm} native promises with ${property} then properties are rejected and observed`, async () => {
      const failure = new Error("original rejection")
      const deferred: { promise: Promise<unknown>; reject: (error: unknown) => void } =
        realm === "current"
          ? Promise.withResolvers<unknown>()
          : runInNewContext("Promise.withResolvers()")
      const value = deferred.promise
      let reads = 0
      // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied promise with a hidden method.
      Object.defineProperty(value, "then", {
        get() {
          reads++
          if (property === "throwing") throw new Error("method unavailable")
          return undefined
        },
      })
      const reported: unknown[] = []
      expect(() =>
        requireSynchronous(value, "must be synchronous", (error) => {
          reported.push(error)
        }),
      ).toThrow("must be synchronous")
      deferred.reject(failure)
      await Bun.sleep(0)
      expect(reads).toBe(0)
      expect(reported).toEqual([failure])
    })
  }
}

test("ordinary thenables retain one method lookup and their original receiver", async () => {
  let reads = 0
  const reported: unknown[] = []
  const failure = new Error("thenable rejection")
  const value = {}
  // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
  Object.defineProperty(value, "then", {
    get() {
      reads++
      if (reads > 1) return undefined
      return function (this: unknown, _resolve: unknown, reject: (error: unknown) => void) {
        expect(this).toBe(value)
        reject(failure)
      }
    },
  })
  expect(() =>
    requireSynchronous(value, "must be synchronous", (error) => {
      reported.push(error)
    }),
  ).toThrow("must be synchronous")
  await Bun.sleep(0)
  expect(reads).toBe(1)
  expect(reported).toEqual([failure])
})

test("synchronous results retain their original values and identities", () => {
  for (const value of [undefined, null, false, 0, "input", {}, () => {}, new Error("value")])
    expect(requireSynchronous(value, "unused")).toBe(value)
})

for (const settlement of ["pending", "resolve", "reject"] as const) {
  for (const kind of ["native", "hidden", "throwing", "other-realm"] as const) {
    test(`a ${kind} promise returned by then is observed after ${settlement}`, async () => {
      const returnedFailure = new Error("then method failed")
      const callbackFailure = new Error("thenable rejected")
      const reported: unknown[] = []
      let reads = 0
      let returnedReads = 0
      class Thenable {
        #calls = 0
        // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
        get then() {
          reads++
          return function (
            this: Thenable,
            resolve: (value: unknown) => void,
            reject: (error: unknown) => void,
          ) {
            this.#calls++
            if (settlement === "resolve") resolve("value")
            if (settlement === "reject") reject(callbackFailure)
            const promise: Promise<unknown> =
              kind === "other-realm"
                ? runInNewContext("Promise.reject(error)", { error: returnedFailure })
                : Promise.reject(returnedFailure)
            // Keep the old implementation safe while checking that the error reaches the host.
            void promise.catch(() => {})
            if (kind === "hidden" || kind === "throwing") {
              // oxlint-disable-next-line unicorn/no-thenable -- Native promise observation must bypass own then getters.
              Object.defineProperty(promise, "then", {
                get() {
                  returnedReads++
                  if (kind === "throwing") throw new Error("method unavailable")
                  return undefined
                },
              })
            }
            return promise
          }
        }
        get calls() {
          return this.#calls
        }
      }
      const value = new Thenable()
      expect(() =>
        requireSynchronous(value, "must be synchronous", (error) => {
          reported.push(error)
        }),
      ).toThrow("must be synchronous")
      await Bun.sleep(0)
      expect(reads).toBe(1)
      expect(value.calls).toBe(1)
      expect(returnedReads).toBe(0)
      const failures =
        settlement === "reject" ? [returnedFailure, callbackFailure] : [returnedFailure]
      expect(reported).toHaveLength(failures.length)
      expect(new Set(reported)).toEqual(new Set(failures))
    })
  }
}

test("a then method returning its original thenable is not invoked again", async () => {
  let calls = 0
  const errors: unknown[] = []
  const value = {
    // oxlint-disable-next-line unicorn/no-thenable -- Exercise a chainable host-supplied thenable.
    then(resolve: (value: unknown) => void) {
      calls++
      resolve("value")
      return value
    },
  }
  expect(() =>
    requireSynchronous(value, "must be synchronous", (error) => {
      errors.push(error)
    }),
  ).toThrow("must be synchronous")
  await Bun.sleep(0)
  expect(calls).toBe(1)
  expect(errors).toEqual([])
})
