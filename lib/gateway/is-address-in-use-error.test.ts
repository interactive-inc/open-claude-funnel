import { describe, expect, test } from "bun:test"
import { isAddressInUseError } from "@/gateway/is-address-in-use-error"

describe("isAddressInUseError", () => {
  test("matches Bun's real port-collision error (marker is on .code, not the message)", () => {
    // Bun.serve throws exactly this shape on a collision: the message never
    // contains "EADDRINUSE", only error.code does. A message-only check misses it.
    const error = Object.assign(new Error("Failed to start server. Is port 9743 in use?"), {
      code: "EADDRINUSE",
    })

    expect(isAddressInUseError(error)).toBe(true)
  })

  test("matches the POSIX 'address already in use' message", () => {
    const error = new Error("listen EADDRINUSE: address already in use 127.0.0.1:9743")

    expect(isAddressInUseError(error)).toBe(true)
  })

  test("does not match an unrelated start failure", () => {
    expect(isAddressInUseError(new Error("permission denied"))).toBe(false)
  })

  test("returns false for a non-Error value", () => {
    expect(isAddressInUseError("EADDRINUSE")).toBe(false)
  })
})
