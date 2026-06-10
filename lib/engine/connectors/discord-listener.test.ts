import { afterEach, beforeEach, describe, expect, vi, test } from "vitest"
import { FunnelDiscordListener } from "@/engine/connectors/discord-listener"
import type { DiscordConnectorConfig } from "@/engine/connectors/discord-connector-schema"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

type Handler = (...args: unknown[]) => void | Promise<void>

const hoisted = {
  handlers: new Map<string, Handler>(),
  mockClient: null as MockClient | null,
  loginError: null as Error | null,
  ownUserId: "U_BOT",
}

type MockClient = {
  user: { id: string } | null
  on: ReturnType<typeof vi.fn>
  login: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

vi.mock("discord.js", () => {
  class FakeClient {
    user: { id: string } | null = null
    on: ReturnType<typeof vi.fn>
    login: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>

    constructor() {
      this.on = vi.fn((event: string, handler: Handler) => {
        hoisted.handlers.set(event, handler)
      })
      this.login = vi.fn(() => {
        if (hoisted.loginError) return Promise.reject(hoisted.loginError)
        this.user = { id: hoisted.ownUserId }
        return Promise.resolve("ok")
      })
      this.destroy = vi.fn(() => Promise.resolve(undefined))
      hoisted.mockClient = this as unknown as MockClient
    }
  }

  return {
    Client: FakeClient,
    GatewayIntentBits: {
      Guilds: 1,
      GuildMessages: 2,
      MessageContent: 4,
      DirectMessages: 8,
    },
    Partials: { Channel: "Channel" },
  }
})

const buildConfig = (): DiscordConnectorConfig => ({
  id: "co-1",
  type: "discord",
  name: "test",
  botToken: "x".repeat(50),
})

// A Discord.js Message shaped just enough for the listener: author + mentions
// collection (exposing keys()) + toJSON().
const buildMessage = (props: {
  authorId: string
  authorIsBot: boolean
  channelId?: string
  guildId?: string | null
  mentionedUserIds?: string[]
}): unknown => {
  const raw = {
    id: "M1",
    author: { id: props.authorId, bot: props.authorIsBot },
    channelId: props.channelId ?? "C1",
    guildId: props.guildId ?? "G1",
    content: "hello",
  }

  return {
    author: { id: props.authorId, bot: props.authorIsBot },
    channelId: props.channelId ?? "C1",
    guildId: props.guildId ?? "G1",
    mentions: { users: new Map((props.mentionedUserIds ?? []).map((id) => [id, { id }])) },
    toJSON: () => raw,
  }
}

const fireMessage = async (message: unknown): Promise<void> => {
  const handler = hoisted.handlers.get("messageCreate")
  await handler?.(message)
}

beforeEach(() => {
  hoisted.handlers.clear()
  hoisted.mockClient = null
  hoisted.loginError = null
  hoisted.ownUserId = "U_BOT"
})

afterEach(() => {
  hoisted.handlers.clear()
  hoisted.mockClient = null
  hoisted.loginError = null
})

describe("FunnelDiscordListener: diagnostic log", () => {
  test("records a raw row and an emitted processed row with a shared eventId", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelDiscordListener({
      config: buildConfig(),
      channelId: "ch-uuid-1",
      diagnosticLog,
    })

    await listener.start(async () => {})
    await fireMessage(buildMessage({ authorId: "U_REAL", authorIsBot: false }))

    const raws = diagnosticLog.queryRaw({})
    expect(raws).toHaveLength(1)
    expect(raws[0]?.type).toBe("discord")
    expect(raws[0]?.connectorId).toBe("co-1")
    expect(raws[0]?.channelId).toBe("ch-uuid-1")

    const processed = diagnosticLog.queryProcessed({})
    expect(processed).toHaveLength(1)
    expect(processed[0]?.outcome).toBe("emitted")
    expect(processed[0]?.eventId).toBe(raws[0]?.eventId ?? "")
  })

  test("records the raw event but a skip:bot outcome for a bot-authored message", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelDiscordListener({ config: buildConfig(), diagnosticLog })

    await listener.start(async () => {})
    await fireMessage(buildMessage({ authorId: "U_OTHER_BOT", authorIsBot: true }))

    expect(diagnosticLog.queryRaw({})).toHaveLength(1)
    expect(diagnosticLog.queryProcessed({ outcome: "emitted" })).toHaveLength(0)
    const skipped = diagnosticLog.queryProcessed({ outcome: "skip:bot" })
    expect(skipped).toHaveLength(1)
    // The skip row joins to its raw twin by eventId.
    expect(skipped[0]?.eventId).toBe(diagnosticLog.queryRaw({})[0]?.eventId ?? "")
  })
})

describe("FunnelDiscordListener: connection lifecycle", () => {
  test("records started then connected on a successful start", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelDiscordListener({ config: buildConfig(), diagnosticLog })

    await listener.start(async () => {})

    const statuses = diagnosticLog.queryConnection({}).map((row) => row.status)
    expect(statuses).toContain("started")
    expect(statuses).toContain("connected")
  })

  test("records disconnected then stopped on stop()", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelDiscordListener({ config: buildConfig(), diagnosticLog })

    await listener.start(async () => {})
    await listener.stop()

    const statuses = diagnosticLog.queryConnection({}).map((row) => row.status)
    expect(statuses).toContain("disconnected")
    expect(statuses).toContain("stopped")
  })
})

describe("FunnelDiscordListener: no diagnostic log", () => {
  test("records nothing and does not throw when no diagnosticLog is injected", async () => {
    const listener = new FunnelDiscordListener({ config: buildConfig() })

    await listener.start(async () => {})
    // Exercising the record paths; absence of a throw is the assertion.
    await fireMessage(buildMessage({ authorId: "U_REAL", authorIsBot: false }))
    await fireMessage(buildMessage({ authorId: "U_BOT_2", authorIsBot: true }))
    await listener.stop()
  })
})
