import { describe, expect, test } from "vitest"
import { Hono } from "hono"
import { constantTimeEqual, requireBearerToken } from "@/gateway/auth-middleware"

describe("constantTimeEqual", () => {
  for (const [label, left, right] of [
    ["a high surrogate and replacement", "example-\uD800", "example-\uFFFD"],
    ["different high surrogates", "example-\uD800", "example-\uD801"],
    ["a low surrogate and replacement", "example-\uDC00", "example-\uFFFD"],
    ["multiple replacements", "example-\uD800\uD801", "example-\uFFFD\uFFFD"],
  ] as const) {
    test(`does not alias ${label} during token comparison`, () => {
      expect(constantTimeEqual(left, right)).toBe(false)
      expect(constantTimeEqual(right, left)).toBe(false)
      expect(constantTimeEqual(left, left)).toBe(true)
    })
  }

  test("matches valid Unicode exactly", () => {
    expect(constantTimeEqual("example-\u2603-\u{1F600}", "example-\u2603-\u{1F600}")).toBe(true)
    expect(constantTimeEqual("example-\u2603-\u{1F600}", "example-\u2603-\u{1F601}")).toBe(false)
  })
  test("returns true for equal strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true)
  })

  test("returns false for different strings of equal length", () => {
    expect(constantTimeEqual("abcd", "abce")).toBe(false)
  })

  test("returns false for different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false)
  })

  test("returns false when one is empty", () => {
    expect(constantTimeEqual("", "abc")).toBe(false)
  })
})

const buildApp = (token: string): Hono => {
  const app = new Hono()
  app.use("/protected/*", requireBearerToken({ expected: token }))
  app.get("/protected/ping", (c) => c.text("pong"))
  app.get("/open", (c) => c.text("hello"))

  return app
}

describe("requireBearerToken", () => {
  test("allows requests with the matching bearer token", async () => {
    const app = buildApp("secret")
    const res = await app.request("/protected/ping", {
      headers: { authorization: "Bearer secret" },
    })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("pong")
  })

  test("rejects missing authorization header", async () => {
    const app = buildApp("secret")
    const res = await app.request("/protected/ping")

    expect(res.status).toBe(401)
  })

  test("rejects wrong token", async () => {
    const app = buildApp("secret")
    const res = await app.request("/protected/ping", {
      headers: { authorization: "Bearer nope" },
    })

    expect(res.status).toBe(401)
  })

  test("does not affect routes that did not register the middleware", async () => {
    const app = buildApp("secret")
    const res = await app.request("/open")

    expect(res.status).toBe(200)
  })
})
