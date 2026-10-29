import { expect, test } from "bun:test"
import { errorMessageOf } from "@/engine/error/error-message-of"

test("error messages retain ordinary errors and primitive thrown values", () => {
  expect(errorMessageOf(new Error("failed"))).toBe("failed")
  expect(errorMessageOf("failed")).toBe("failed")
  expect(errorMessageOf(undefined)).toBe("undefined")
  expect(errorMessageOf(null)).toBe("null")
  expect(errorMessageOf(42)).toBe("42")
  expect(errorMessageOf(Symbol("failure"))).toBe("Symbol(failure)")
})

test("unprintable thrown values have a stable fallback", () => {
  const revoked = Proxy.revocable({}, {})
  revoked.revoke()
  const unreadable = new Error()
  Object.defineProperty(unreadable, "message", {
    get() {
      throw new Error("message failed")
    },
  })
  for (const value of [
    Object.create(null),
    revoked.proxy,
    unreadable,
    {
      toString() {
        throw new Error("conversion failed")
      },
    },
    {
      [Symbol.toPrimitive]() {
        throw new Error("conversion failed")
      },
    },
  ]) {
    expect(errorMessageOf(value)).toBe("Unprintable thrown value")
  }
})
