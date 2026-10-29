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
