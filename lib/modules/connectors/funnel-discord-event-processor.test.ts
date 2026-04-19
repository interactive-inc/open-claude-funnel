import { describe, expect, test } from "bun:test"
import { FunnelDiscordEventProcessor } from "@/modules/connectors/funnel-discord-event-processor"

const make = () => new FunnelDiscordEventProcessor({ ownUserId: "UBOT" })

describe("FunnelDiscordEventProcessor", () => {
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
