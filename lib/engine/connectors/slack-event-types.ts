export type SlackMessageEvent = {
  kind: "message"
  channel: string
  user: string
  rawText: string
  text: string
  threadTs: string
  ts: string
  isThreadRoot: boolean
  mentioned: boolean
  source: "app_mention" | "message"
}

export type SlackEvent = SlackMessageEvent
