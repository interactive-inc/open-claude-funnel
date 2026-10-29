import { describe, expect, test } from "vitest"
import { minifySlackEvent } from "@/engine/connectors/minify-slack-event"
import { FunnelSlackEventProcessor } from "@/engine/connectors/slack-event-processor"

describe("minifySlackEvent", () => {
  for (const style of ["bullet", "ordered"] as const) {
    test(`preserves paragraph and ${style} list boundaries through attachment delivery`, () => {
      const section = (...parts: string[]) => ({
        type: "rich_text_section",
        elements: parts.map((text) => ({ type: "text", text })),
      })
      const input = {
        type: "message",
        user: "UOTHER",
        channel: "C1",
        ts: "1.0",
        attachments: [
          {
            text: "Report",
            blocks: [
              {
                type: "rich_text",
                elements: [
                  section("Summary"),
                  {
                    type: "rich_text_list",
                    style,
                    elements: [section("One", " item"), section("Another", " item")],
                  },
                  section("Done"),
                ],
              },
            ],
          },
        ],
      }
      const original = structuredClone(input)
      const result = new FunnelSlackEventProcessor({
        ownBotUserId: "BOT",
        ownBotId: "BOT_ID",
      }).process(input)
      expect(result.skip).toBe(false)
      if (result.skip) throw new Error("Expected delivery")
      expect(JSON.parse(result.content).attachments[0]).toEqual({
        text: "Report\nSummary\nOne item\nAnother item\nDone",
        _funnel_omitted: ["blocks"],
      })
      expect(input).toEqual(original)
    })
  }

  for (const layout of ["rich_text", "table"] as const) {
    test(`preserves an unlabeled link through ${layout} attachment delivery`, () => {
      const section = {
        type: "rich_text_section",
        elements: [
          { type: "text", text: "Read " },
          { type: "link", url: "https://example.com/guide" },
          { type: "text", text: " now" },
        ],
      }
      const block =
        layout === "table"
          ? { type: "table", rows: [[section]] }
          : { type: "rich_text", elements: [section] }
      const input = {
        type: "message",
        user: "UOTHER",
        channel: "C1",
        ts: "1.0",
        attachments: [{ blocks: [block] }],
      }
      const original = structuredClone(input)
      const result = new FunnelSlackEventProcessor({
        ownBotUserId: "BOT",
        ownBotId: "BOT_ID",
      }).process(input)
      expect(result.skip).toBe(false)
      if (result.skip) throw new Error("Expected delivery")
      expect(JSON.parse(result.content).attachments[0]).toEqual({
        text: "Read https://example.com/guide now",
        _funnel_omitted: ["blocks"],
      })
      expect(input).toEqual(original)
    })
  }

  test("preserves both section text and fields through the delivery processor", () => {
    const input = {
      type: "message",
      user: "UOTHER",
      channel: "C1",
      ts: "1.0",
      attachments: [
        {
          text: "Report",
          blocks: [
            {
              type: "section",
              text: { type: "mrkdwn", text: "Summary" },
              fields: [
                { type: "plain_text", text: "Status: pending" },
                { type: "mrkdwn", text: "Owner: unassigned" },
              ],
            },
          ],
        },
      ],
    }
    const original = structuredClone(input)
    const result = new FunnelSlackEventProcessor({
      ownBotUserId: "BOT",
      ownBotId: "BOT_ID",
    }).process(input)
    expect(result.skip).toBe(false)
    if (result.skip) throw new Error("Expected delivery")
    expect(JSON.parse(result.content).attachments[0]).toEqual({
      text: "Report\nSummary\nStatus: pending\nOwner: unassigned",
      _funnel_omitted: ["blocks"],
    })
    expect(input).toEqual(original)
  })

  test("preserves fields alongside string section text", () => {
    const result = minifySlackEvent({
      attachments: [{ blocks: [{ text: "Summary", fields: [{ text: "Details" }] }] }],
    })
    expect(result.attachments).toEqual([
      {
        text: "Summary\nDetails",
        _funnel_omitted: ["blocks"],
      },
    ])
  })

  test("strips thumb fields from files and keeps url_private/permalink", () => {
    const result = minifySlackEvent({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      ts: "1.0",
      files: [
        {
          id: "F1",
          name: "photo.png",
          mimetype: "image/png",
          filetype: "png",
          size: 12345,
          url_private: "https://files.slack.com/F1",
          permalink: "https://slack.com/F1",
          thumb_tiny: "AwAwACEooooA",
          thumb_64: "https://files.slack.com/F1/thumb_64",
          thumb_360: "https://files.slack.com/F1/thumb_360",
          preview: "<long html preview>",
        },
      ],
    })

    const files = result.files

    expect(Array.isArray(files)).toBe(true)
    if (!Array.isArray(files)) return

    const file = files[0]

    expect(file).toMatchObject({
      id: "F1",
      name: "photo.png",
      mimetype: "image/png",
      filetype: "png",
      size: 12345,
      url_private: "https://files.slack.com/F1",
      permalink: "https://slack.com/F1",
      _funnel_omitted: ["thumb_*"],
    })
    expect(file).not.toHaveProperty("thumb_tiny")
    expect(file).not.toHaveProperty("thumb_64")
    expect(file).not.toHaveProperty("thumb_360")
    expect(file).not.toHaveProperty("preview")
  })

  test("omits _funnel_omitted from files that carry no thumb or preview fields", () => {
    const result = minifySlackEvent({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      ts: "1.0",
      files: [
        {
          id: "F1",
          name: "notes.txt",
          mimetype: "text/plain",
          filetype: "text",
          size: 42,
          url_private: "https://files.slack.com/F1",
          permalink: "https://slack.com/F1",
        },
      ],
    })

    const files = result.files

    expect(Array.isArray(files)).toBe(true)
    if (!Array.isArray(files)) return

    const file = files[0]

    expect(file).toMatchObject({
      id: "F1",
      name: "notes.txt",
    })
    expect(file).not.toHaveProperty("_funnel_omitted")
  })

  test("flattens attachment table blocks to plain text and drops boilerplate", () => {
    const result = minifySlackEvent({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      ts: "1.0",
      attachments: [
        {
          title: "Report",
          fallback: "Report fallback",
          id: 1,
          color: "#36a64f",
          blocks: [
            {
              type: "table",
              block_id: "tbl1",
              rows: [
                [
                  {
                    type: "rich_text_section",
                    block_id: "c1",
                    style: { bold: true },
                    elements: [{ type: "text", text: "Name" }],
                  },
                  {
                    type: "rich_text_section",
                    block_id: "c2",
                    style: { bold: true },
                    elements: [{ type: "text", text: "Status" }],
                  },
                ],
                [
                  {
                    type: "rich_text_section",
                    block_id: "c3",
                    elements: [{ type: "text", text: "alpha" }],
                  },
                  {
                    type: "rich_text_section",
                    block_id: "c4",
                    elements: [{ type: "text", text: "done" }],
                  },
                ],
              ],
            },
          ],
        },
      ],
    })

    const attachments = result.attachments

    expect(Array.isArray(attachments)).toBe(true)
    if (!Array.isArray(attachments)) return

    const attachment = attachments[0]

    expect(attachment).toMatchObject({
      title: "Report",
      fallback: "Report fallback",
      text: "Name\tStatus\nalpha\tdone",
      _funnel_omitted: ["blocks"],
    })
    expect(attachment).not.toHaveProperty("blocks")
    expect(attachment).not.toHaveProperty("block_id")
    expect(attachment).not.toHaveProperty("style")
    expect(attachment).not.toHaveProperty("id")
    expect(attachment).not.toHaveProperty("color")
  })

  test("flattens section blocks that carry text objects and fields", () => {
    const result = minifySlackEvent({
      type: "message",
      bot_id: "B1",
      channel: "C1",
      ts: "1.0",
      attachments: [
        {
          fallback: "Security Hub Finding",
          blocks: [
            {
              type: "section",
              block_id: "b1",
              text: { type: "mrkdwn", text: "*Latest Update*: finding created" },
            },
            {
              type: "section",
              block_id: "b2",
              fields: [
                { type: "mrkdwn", text: "*Severity*\nCritical" },
                { type: "mrkdwn", text: "*Last Seen*\nFri, 12 Sep 2026" },
              ],
            },
          ],
        },
      ],
    })

    const attachments = result.attachments

    expect(Array.isArray(attachments)).toBe(true)
    if (!Array.isArray(attachments)) return

    expect(attachments[0]).toMatchObject({
      fallback: "Security Hub Finding",
      text: "*Latest Update*: finding created\n*Severity*\nCritical\n*Last Seen*\nFri, 12 Sep 2026",
      _funnel_omitted: ["blocks"],
    })
  })

  test("drops icons and image_* fields wherever they appear", () => {
    const result = minifySlackEvent({
      type: "message",
      bot_id: "B1",
      channel: "C1",
      ts: "1.0",
      text: "from bot",
      icons: { image_48: "https://a/48", image_72: "https://a/72" },
      image_24: "https://a/24",
      image_32: "https://a/32",
    })

    expect(result).not.toHaveProperty("icons")
    expect(result).not.toHaveProperty("image_24")
    expect(result).not.toHaveProperty("image_32")
    expect(result.bot_id).toBe("B1")
  })

  test("drops boilerplate top-level fields and keeps useful ones", () => {
    const result = minifySlackEvent({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      channel_type: "channel",
      ts: "1.0",
      event_ts: "1.0",
      thread_ts: "0.9",
      text: "hello world",
      client_msg_id: "abc-123",
      team: "T1",
      parent_user_id: "UP",
      blocks: [{ type: "rich_text", block_id: "x" }],
      edited: { user: "UOTHER", ts: "1.1" },
    })

    expect(result).toMatchObject({
      type: "message",
      user: "UOTHER",
      channel: "C1",
      channel_type: "channel",
      ts: "1.0",
      thread_ts: "0.9",
      text: "hello world",
    })
    expect(result).not.toHaveProperty("event_ts")
    expect(result).not.toHaveProperty("client_msg_id")
    expect(result).not.toHaveProperty("team")
    expect(result).not.toHaveProperty("parent_user_id")
    expect(result).not.toHaveProperty("blocks")
    expect(result).not.toHaveProperty("edited")
  })
})
