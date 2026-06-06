import { minifySlackEvent } from "@/engine/connectors/minify-slack-event"

export type SlackRawEvent = Record<string, unknown>

/**
 * Why the processor dropped an event. Mirrored verbatim into the diagnostic
 * log's processed `outcome` column so "Slack delivered it but no notification arrived" is
 * traceable to the exact gate that dropped it. The listener may additionally
 * record `skip:preprocess` for events a host preprocessor dropped before the
 * processor ran — that gate is outside this type.
 */
export type SlackSkipReason =
  | "skip:type"
  | "skip:subtype"
  | "skip:dedup"
  | "skip:self-user"
  | "skip:self-bot"

export type SlackProcessedSkip = { skip: true; reason: SlackSkipReason }

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
  minify?: boolean
  now?: () => number
}

const getString = (event: SlackRawEvent, key: string): string | undefined => {
  const value = event[key]

  return typeof value === "string" ? value : undefined
}

export class FunnelSlackEventProcessor {
  private readonly ownBotUserId: string
  private readonly ownBotId: string
  private readonly minify: boolean
  private readonly now: () => number
  private readonly dedup = new Map<string, number>()

  constructor(props: Props) {
    this.ownBotUserId = props.ownBotUserId
    this.ownBotId = props.ownBotId
    this.minify = props.minify ?? true
    this.now = props.now ?? (() => Date.now())
  }

  process(event: SlackRawEvent): SlackProcessed {
    const eventType = getString(event, "type")

    if (!eventType || !ALLOWED_EVENTS.has(eventType)) return { skip: true, reason: "skip:type" }

    const subtype = getString(event, "subtype")

    if (!ALLOWED_SUBTYPES.has(subtype)) return { skip: true, reason: "skip:subtype" }

    const channelId = getString(event, "channel") ?? ""
    const eventTs = getString(event, "event_ts") ?? getString(event, "ts") ?? ""
    const dedupKey = `${channelId}:${eventTs}`
    const now = this.now()

    if (this.dedup.has(dedupKey)) return { skip: true, reason: "skip:dedup" }

    this.dedup.set(dedupKey, now)

    for (const key of this.dedup.keys()) {
      if ((this.dedup.get(key) ?? 0) < now - DEDUP_WINDOW) this.dedup.delete(key)
    }

    const userId = getString(event, "user")
    const botId = getString(event, "bot_id")

    if (userId === this.ownBotUserId) return { skip: true, reason: "skip:self-user" }
    if (botId === this.ownBotId) return { skip: true, reason: "skip:self-bot" }

    const text = getString(event, "text") ?? ""
    const mentioned = text.includes(`<@${this.ownBotUserId}>`)
    const threadTs = getString(event, "thread_ts") ?? getString(event, "ts") ?? ""
    const emitted = this.minify ? minifySlackEvent(event) : event

    return {
      skip: false,
      content: JSON.stringify(emitted),
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
