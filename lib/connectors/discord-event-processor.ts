export type DiscordInboundMessage = {
  authorId: string
  authorIsBot: boolean
  channelId: string
  guildId: string | null
  mentionedUserIds: string[]
  raw: unknown
}

export type DiscordProcessedSkip = { skip: true }

export type DiscordProcessedEmit = {
  skip: false
  content: string
  meta: Record<string, string>
}

export type DiscordProcessed = DiscordProcessedSkip | DiscordProcessedEmit

type Props = {
  ownUserId: string
}

export class FunnelDiscordEventProcessor {
  private readonly ownUserId: string

  constructor(props: Props) {
    this.ownUserId = props.ownUserId
  }

  process(message: DiscordInboundMessage): DiscordProcessed {
    if (message.authorIsBot) return { skip: true }

    const mentioned = this.ownUserId ? message.mentionedUserIds.includes(this.ownUserId) : false

    return {
      skip: false,
      content: JSON.stringify(message.raw),
      meta: {
        event_type: "discord",
        channel_id: message.channelId,
        user_id: message.authorId,
        mentioned: String(mentioned),
        guild_id: message.guildId ?? "",
      },
    }
  }
}
