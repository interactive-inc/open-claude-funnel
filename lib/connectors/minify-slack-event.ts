import type { SlackRawEvent } from "@/connectors/slack-event-processor"

const TOP_LEVEL_KEYS = [
  "type",
  "subtype",
  "user",
  "bot_id",
  "text",
  "ts",
  "thread_ts",
  "channel",
  "channel_type",
  "files",
  "attachments",
]

const FILE_KEYS = ["id", "name", "mimetype", "filetype", "size", "url_private", "permalink"]

const ATTACHMENT_KEYS = ["title", "text", "fallback"]

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const pickDefined = (
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> => {
  const picked: Record<string, unknown> = {}

  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key]
  }

  return picked
}

const hasThumbOrPreviewKey = (file: Record<string, unknown>): boolean => {
  return Object.keys(file).some((key) => key.startsWith("thumb") || key.startsWith("preview"))
}

const minifyFile = (file: unknown): unknown => {
  if (!isRecord(file)) return file

  const minified = pickDefined(file, FILE_KEYS)

  if (hasThumbOrPreviewKey(file)) minified._funnel_omitted = ["thumb_*"]

  return minified
}

// Slack rich_text_section nodes carry text under elements[].text;
// concatenating those yields the plain text of a single table cell.
const flattenRichText = (node: unknown): string => {
  if (!isRecord(node)) return ""

  const text = node.text

  if (typeof text === "string") return text

  const elements = node.elements

  if (!Array.isArray(elements)) return ""

  return elements.map(flattenRichText).join("")
}

const flattenTableRow = (row: unknown): string => {
  if (!Array.isArray(row)) return ""

  return row.map(flattenRichText).join("\t")
}

const flattenBlock = (block: unknown): string => {
  if (!isRecord(block)) return ""

  if (block.type === "table" && Array.isArray(block.rows)) {
    return block.rows.map(flattenTableRow).join("\n")
  }

  return flattenRichText(block)
}

const flattenBlocks = (blocks: unknown[]): string => {
  return blocks
    .map(flattenBlock)
    .filter((line) => line.length > 0)
    .join("\n")
}

const minifyAttachment = (attachment: unknown): unknown => {
  if (!isRecord(attachment)) return attachment

  const minified = pickDefined(attachment, ATTACHMENT_KEYS)
  const blocks = attachment.blocks

  if (Array.isArray(blocks)) {
    const flattened = flattenBlocks(blocks)
    const existingText = typeof minified.text === "string" ? minified.text : ""

    minified.text = existingText ? `${existingText}\n${flattened}` : flattened
    minified._funnel_omitted = ["blocks"]
  }

  return minified
}

export const minifySlackEvent = (event: SlackRawEvent): SlackRawEvent => {
  const minified = pickDefined(event, TOP_LEVEL_KEYS)

  if (Array.isArray(minified.files)) {
    minified.files = minified.files.map(minifyFile)
  }

  if (Array.isArray(minified.attachments)) {
    minified.attachments = minified.attachments.map(minifyAttachment)
  }

  return minified
}
