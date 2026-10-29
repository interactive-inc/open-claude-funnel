import { describe, expect, test } from "vitest"
import { FunnelDiscordEventProcessor } from "@/engine/connectors/discord-event-processor"

const make = () => new FunnelDiscordEventProcessor({ ownUserId: "UBOT" })

describe("FunnelDiscordEventProcessor", () => {
  for (const [name, raw] of [
    ["undefined", undefined],
    ["function", () => "unused"],
    ["symbol", Symbol("event")],
    ["empty toJSON result", { toJSON: () => undefined }],
  ] as const) {
    test(`rejects ${name} instead of emitting undefined content`, () => {
      const processor = make()
      const input = {
        authorId: "U1",
        authorIsBot: false,
        channelId: "C1",
        guildId: null,
        mentionedUserIds: [],
        raw,
      }
      expect(() => processor.process(input)).toThrow("Discord event could not be serialized")
      expect(processor.process({ ...input, raw: { content: "retry" } })).toMatchObject({
        skip: false,
        content: '{"content":"retry"}',
      })
      expect(processor.process({ ...input, authorIsBot: true })).toEqual({ skip: true })
    })
  }

  test("retains valid falsy JSON content", () => {
    for (const raw of [null, false, 0, ""]) {
      expect(
        make().process({
          authorId: "U1",
          authorIsBot: false,
          channelId: "C1",
          guildId: null,
          mentionedUserIds: [],
          raw,
        }),
      ).toMatchObject({ skip: false, content: JSON.stringify(raw) })
    }
  })

  test("skips messages from bots", () => {
    const result = make().process({
      authorId: "OTHERBOT",
      authorIsBot: true,
      channelId: "C1",
      guildId: null,
      mentionedUserIds: [],
      raw: {},
    })

    expect(result.skip).toBe(true)
  })

  test("detects mentions", () => {
    const result = make().process({
      authorId: "U1",
      authorIsBot: false,
      channelId: "C1",
      guildId: "G1",
      mentionedUserIds: ["UBOT"],
      raw: { content: "hi" },
    })

    expect(result.skip).toBe(false)
    if (!result.skip) {
      expect(result.meta.mentioned).toBe("true")
      expect(result.meta.guild_id).toBe("G1")
    }
  })

  test("DM (guildId null) yields empty guild_id", () => {
    const result = make().process({
      authorId: "U1",
      authorIsBot: false,
      channelId: "D1",
      guildId: null,
      mentionedUserIds: [],
      raw: { content: "hi" },
    })

    expect(result.skip).toBe(false)
    if (!result.skip) {
      expect(result.meta.guild_id).toBe("")
      expect(result.meta.channel_id).toBe("D1")
    }
  })
})
