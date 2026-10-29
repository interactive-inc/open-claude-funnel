import { describe, expect, test } from "vitest"
import { resolveConnectorToken } from "@/engine/connectors/resolve-connector-token"

describe("resolveConnectorToken", () => {
  test("returns the literal when present", () => {
    const token = resolveConnectorToken({
      literal: "xoxb-literal",
      envVar: undefined,
      env: {},
      label: "slack.botToken",
    })

    expect(token).toEqual("xoxb-literal")
  })

  test("resolves the env var when only a reference is given", () => {
    const token = resolveConnectorToken({
      literal: undefined,
      envVar: "SLACK_BOT_TOKEN",
      env: { SLACK_BOT_TOKEN: "xoxb-fromenv" },
      label: "slack.botToken",
    })

    expect(token).toEqual("xoxb-fromenv")
  })

  test("prefers the literal over a reference", () => {
    const token = resolveConnectorToken({
      literal: "xoxb-literal",
      envVar: "SLACK_BOT_TOKEN",
      env: { SLACK_BOT_TOKEN: "xoxb-fromenv" },
      label: "slack.botToken",
    })

    expect(token).toEqual("xoxb-literal")
  })

  test("throws naming the var when the reference is unset", () => {
    expect(() =>
      resolveConnectorToken({
        literal: undefined,
        envVar: "SLACK_BOT_TOKEN",
        env: {},
        label: "slack.botToken",
      }),
    ).toThrow(/SLACK_BOT_TOKEN/)
  })

  test("throws when neither a literal nor a reference is given", () => {
    expect(() =>
      resolveConnectorToken({
        literal: undefined,
        envVar: undefined,
        env: {},
        label: "slack.botToken",
      }),
    ).toThrow(/neither/)
  })

  test("invalid literal values fail before consulting an environment fallback", () => {
    for (const literal of [null, 42, false, [], {}, () => "example"]) {
      let reads = 0
      const env = Object.defineProperty({}, "EXAMPLE_TOKEN", {
        get() {
          reads++
          return "example-value"
        },
      })
      expect(() =>
        resolveConnectorToken({
          literal: literal as never,
          envVar: "EXAMPLE_TOKEN",
          env,
          label: "example.token",
        }),
      ).toThrow("literal token must be a string")
      expect(reads).toBe(0)
    }
  })

  test("invalid environment reference values are not coerced into variable names", () => {
    let coerced = 0
    const reference = {
      toString() {
        coerced++
        return "EXAMPLE_TOKEN"
      },
    }
    for (const envVar of [null, 42, false, ["EXAMPLE_TOKEN"], reference]) {
      expect(() =>
        resolveConnectorToken({
          literal: undefined,
          envVar: envVar as never,
          env: { "42": "example-value", EXAMPLE_TOKEN: "example-value" },
          label: "example.token",
        }),
      ).toThrow("env var reference must be a string")
    }
    expect(coerced).toBe(0)
  })

  test("literal token resolution reads the chosen value once", () => {
    let reads = 0
    expect(
      resolveConnectorToken({
        get literal() {
          reads++
          return reads === 1 ? "first-value" : "later-value"
        },
        get envVar(): string {
          throw new Error("Unused reference must not be read")
        },
        env: {},
        label: "example.token",
      }),
    ).toBe("first-value")
    expect(reads).toBe(1)
  })

  test("reference lookup uses the same environment and key it checked for ownership", () => {
    let referenceReads = 0
    let environmentReads = 0
    expect(
      resolveConnectorToken({
        literal: undefined,
        get envVar() {
          referenceReads++
          return referenceReads === 1 ? "FIRST" : "SECOND"
        },
        get env() {
          environmentReads++
          return environmentReads === 1
            ? { FIRST: "first-value", SECOND: "second-value" }
            : Object.create({ SECOND: "inherited-value" })
        },
        label: "example.token",
      }),
    ).toBe("first-value")
    expect(referenceReads).toBe(1)
    expect(environmentReads).toBe(1)
  })
})
