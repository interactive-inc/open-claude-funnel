import { describe, expect, test } from "bun:test"
import { redactSecrets } from "@/engine/logger/redact-secrets"

// Fixtures are assembled at runtime so no token-shaped literal exists in the
// source — GitHub push protection would otherwise flag them as real secrets.
const slackBotToken = ["xoxb", "1234567890", "abcdefGHIJKL"].join("-")
const slackAppToken = ["xapp", "1", "A012345", "9876543210", "deadbeef"].join("-")
const githubClassicToken = ["ghp", "AbCdEfGhIjKlMnOpQrStUvWxYz012345"].join("_")
const githubFineGrainedToken = ["github", "pat", "11AAAAAAA0123456789abcdefghij"].join("_")
const discordBotAuth = `Bot ${["MTAxMjM0NTY3ODkwMTIzNDU2", "GabcdE", "fghijKLMNopqrstUVWXyz0123456789abc"].join(".")}`
const bearerValue = `Bearer ${["0123456789abcdef", "0123"].join("")}`

describe("redactSecrets", () => {
  test("masks Slack bot tokens", () => {
    const line = `{"meta":{"token":"${slackBotToken}"}}`

    expect(redactSecrets(line)).toBe(`{"meta":{"token":"[redacted]"}}`)
  })

  test("masks Slack app tokens", () => {
    const line = `failed with ${slackAppToken}`

    expect(redactSecrets(line)).toBe("failed with [redacted]")
  })

  test("masks GitHub personal access tokens", () => {
    const classic = `auth: ${githubClassicToken}`
    const fineGrained = `auth: ${githubFineGrainedToken}`

    expect(redactSecrets(classic)).toBe("auth: [redacted]")
    expect(redactSecrets(fineGrained)).toBe("auth: [redacted]")
  })

  test("masks Discord bot authorization values", () => {
    expect(redactSecrets(discordBotAuth)).toBe("[redacted]")
  })

  test("masks bearer header values", () => {
    const line = `authorization: ${bearerValue}`

    expect(redactSecrets(line)).toBe("authorization: [redacted]")
  })

  test("leaves ordinary log lines untouched", () => {
    const line = `{"level":"info","message":"listener started","meta":{"channel":"dev"}}`

    expect(redactSecrets(line)).toBe(line)
  })

  test("leaves short non-token words starting with known prefixes untouched", () => {
    expect(redactSecrets("xoxb-short")).toBe("xoxb-short")
    expect(redactSecrets("ghp_short")).toBe("ghp_short")
  })
})
