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
})
