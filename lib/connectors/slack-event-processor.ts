export type SlackRawEvent = Record<string, unknown>

export type SlackProcessedSkip = { skip: true }

export type SlackProcessedEmit = {
  skip: false
  content: string
  meta: Record<string, string>
  shouldReact: boolean
  channel: string
  timestamp: string
}

export type SlackProcessed = SlackProcessedSkip | SlackProcessedEmit

const ALLOWED_EVENTS = new Set(["message", "app_mention"])
const ALLOWED_SUBTYPES = new Set<string | undefined>([
  undefined,
  "thread_broadcast",
  "bot_message",
  "file_share",
])

const DEDUP_WINDOW = 10_000

type Props = {
  ownBotUserId: string
  ownBotId: string
  now?: () => number
}

const getString = (event: SlackRawEvent, key: string): string | undefined => {
  const value = event[key]

  return typeof value === "string" ? value : undefined
}

export class FunnelSlackEventProcessor {
  private readonly ownBotUserId: string
  private readonly ownBotId: string
  private readonly now: () => number
  private readonly dedup = new Map<string, number>()

  constructor(props: Props) {
    this.ownBotUserId = props.ownBotUserId
    this.ownBotId = props.ownBotId
    this.now = props.now ?? (() => Date.now())
  }

  process(event: SlackRawEvent): SlackProcessed {
    const eventType = getString(event, "type")

    if (!eventType || !ALLOWED_EVENTS.has(eventType)) return { skip: true }

    const subtype = getString(event, "subtype")

    if (!ALLOWED_SUBTYPES.has(subtype)) return { skip: true }

    const channelId = getString(event, "channel") ?? ""
    const eventTs = getString(event, "event_ts") ?? getString(event, "ts") ?? ""
    const dedupKey = `${channelId}:${eventTs}`
    const now = this.now()

    if (this.dedup.has(dedupKey)) return { skip: true }

    this.dedup.set(dedupKey, now)

    for (const key of this.dedup.keys()) {
      if ((this.dedup.get(key) ?? 0) < now - DEDUP_WINDOW) this.dedup.delete(key)
    }

    const userId = getString(event, "user")
    const botId = getString(event, "bot_id")

    if (userId === this.ownBotUserId) return { skip: true }
    if (botId === this.ownBotId) return { skip: true }

    const text = getString(event, "text") ?? ""
    const mentioned = text.includes(`<@${this.ownBotUserId}>`)
    const threadTs = getString(event, "thread_ts") ?? getString(event, "ts") ?? ""

    return {
      skip: false,
      content: JSON.stringify(event),
      meta: {
        event_type: "slack",
        channel_id: channelId,
        user_id: userId ?? "",
        mentioned: String(mentioned),
        thread_ts: threadTs,
      },
      shouldReact: mentioned,
      channel: channelId,
      timestamp: getString(event, "ts") ?? "",
    }
  }
}
