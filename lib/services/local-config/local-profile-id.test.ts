import { describe, expect, test } from "bun:test"
import { localProfileId } from "@/services/local-config/local-profile-id"

describe("localProfileId", () => {
  test("is stable, distinct, and filesystem safe", () => {
    const first = localProfileId("dev/*")

    expect(first).toBe(localProfileId("dev/*"))
    expect(first).not.toBe(localProfileId("review"))
    expect(first).toMatch(/^local-[a-f0-9]{32}$/)
  })
})
