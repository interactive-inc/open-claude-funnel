import { expect, test } from "bun:test"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"
import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"

for (const envVar of ["toString", "constructor", "__proto__"]) {
  test(`an absent environment variable named ${envVar} is not an inherited credential`, () => {
    expect(() =>
      resolveConnectorToken({
        literal: undefined,
        envVar,
        env: {},
        label: "source.token",
      }),
    ).toThrow(`references env var "${envVar}" but it is not set`)
  })
}

test("a supplied environment dictionary does not inherit credentials from its prototype", () => {
  const prototype = { EXAMPLE_TOKEN: "inherited-token" }
  const env: NodeJS.ProcessEnv = {}
  Object.setPrototypeOf(env, prototype)
  expect(() =>
    resolveConnectorToken({
      literal: undefined,
      envVar: "EXAMPLE_TOKEN",
      env,
      label: "source.token",
    }),
  ).toThrow("not set in the environment")
})

test("own environment variables with prototype-like names remain valid", () => {
  for (const envVar of ["toString", "constructor", "__proto__"]) {
    const env: NodeJS.ProcessEnv = {}
    Object.defineProperty(env, envVar, { value: "explicit-token", enumerable: true })
    expect(resolveConnectorToken({ literal: undefined, envVar, env, label: "source.token" })).toBe(
      "explicit-token",
    )
  }
})

test("own non-string environment values cannot become an Authorization credential", () => {
  const env: NodeJS.ProcessEnv = {}
  Object.defineProperty(env, "EXAMPLE_TOKEN", {
    value: { credential: "invalid" },
    enumerable: true,
  })
  expect(() =>
    resolveConnectorToken({
      literal: undefined,
      envVar: "EXAMPLE_TOKEN",
      env,
      label: "source.token",
    }),
  ).toThrow("not set in the environment")
})

test("an adapter rejects a missing prototype-named credential before making an external request", () => {
  const http = new MemoryFunnelHttpClient()
  expect(
    () =>
      new FunnelGhAdapter({
        config: { id: "source", name: "source", type: "gh", tokenEnv: "toString" },
        env: {},
        http,
      }),
  ).toThrow("not set in the environment")
  expect(http.calls).toEqual([])
})
