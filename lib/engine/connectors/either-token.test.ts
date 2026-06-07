import { describe, expect, test } from "bun:test"
import { appTokenSlot, botTokenSlot, type EitherToken } from "@/engine/connectors/either-token"

describe("botTokenSlot", () => {
  test("picks the literal when only literal is set", () => {
    expect(botTokenSlot({ literal: "xoxb-abc", env: undefined })).toEqual({ botToken: "xoxb-abc" })
  })

  test("picks the env ref when only env is set", () => {
    expect(botTokenSlot({ literal: undefined, env: "SLACK_BOT" })).toEqual({
      botTokenEnv: "SLACK_BOT",
    })
  })

  test("prefers env over literal when both are set", () => {
    expect(botTokenSlot({ literal: "xoxb-abc", env: "SLACK_BOT" })).toEqual({
      botTokenEnv: "SLACK_BOT",
    })
  })

  test("returns empty when neither is set", () => {
    expect(botTokenSlot({ literal: undefined, env: undefined })).toEqual({})
  })
})

describe("appTokenSlot", () => {
  test("projects onto appToken / appTokenEnv keys", () => {
    expect(appTokenSlot({ literal: "xapp-abc", env: undefined })).toEqual({ appToken: "xapp-abc" })
    expect(appTokenSlot({ literal: undefined, env: "SLACK_APP" })).toEqual({
      appTokenEnv: "SLACK_APP",
    })
  })
})

describe("EitherToken type", () => {
  test("accepts literal-only, env-only, and neither", () => {
    const literal: EitherToken<"botToken", "botTokenEnv"> = { botToken: "xoxb-x" }
    const env: EitherToken<"botToken", "botTokenEnv"> = { botTokenEnv: "SLACK_BOT" }
    const neither: EitherToken<"botToken", "botTokenEnv"> = {}

    expect([literal, env, neither]).toHaveLength(3)
  })

  test("rejects both literal and env at once", () => {
    // @ts-expect-error — literal and env are mutually exclusive
    const both: EitherToken<"botToken", "botTokenEnv"> = {
      botToken: "xoxb-x",
      botTokenEnv: "SLACK_BOT",
    }

    expect(both).toBeDefined()
  })
})
