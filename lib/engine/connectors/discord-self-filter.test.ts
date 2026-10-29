import { expect, test } from "bun:test"
import type { FlumeRuntimeDeps } from "@interactive-inc/flume"
import { FunnelDiscordEventProcessor } from "@/engine/connectors/discord-event-processor"
import { FunnelFlumeDiscordListener } from "@/engine/connectors/discord-flume-listener"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

const message = {
  authorId: "BOT",
  authorIsBot: false,
  channelId: "channel",
  guildId: null,
  mentionedUserIds: [],
  raw: { content: "update" },
}

test("known self-authored messages are skipped even without a bot flag", () => {
  const processor = new FunnelDiscordEventProcessor({ ownUserId: "BOT" })
  expect(processor.process(message)).toEqual({ skip: true })
})

test("unknown and unrelated authors are not mistaken for self", () => {
  const processor = new FunnelDiscordEventProcessor({ ownUserId: "BOT" })
  expect(processor.process({ ...message, authorId: "USER" }).skip).toBe(false)
  expect(processor.process({ ...message, authorId: "" }).skip).toBe(false)
  expect(
    new FunnelDiscordEventProcessor({ ownUserId: "" }).process({ ...message, authorId: "" }).skip,
  ).toBe(false)
})

class Socket extends EventTarget {
  static latest: Socket
  static OPEN = 1
  static CLOSED = 3
  readyState = 1
  constructor() {
    super()
    Socket.latest = this
    setTimeout(() => this.emit({ op: 10, d: { heartbeat_interval: 60_000 } }), 0)
  }
  send(payload: string): void {
    const frame: unknown = JSON.parse(payload)
    if (typeof frame !== "object" || frame === null || !("op" in frame)) return
    if (frame.op === 2)
      queueMicrotask(() =>
        this.emit({
          op: 0,
          t: "READY",
          s: 1,
          d: {
            user: { id: "BOT" },
            session_id: "example-session",
            resume_gateway_url: "wss://gateway.example",
          },
        }),
      )
    if (frame.op === 1) queueMicrotask(() => this.emit({ op: 11, d: null }))
  }
  close(): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatchEvent(new CloseEvent("close", { code: 1000, reason: "" }))
  }
  emit(frame: Record<string, unknown>): void {
    if (this.readyState !== 1) return
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(frame) }))
  }
}

class Listener extends FunnelFlumeDiscordListener {
  async flush(): Promise<void> {
    await this.running?.drain()
  }
}

test("a partial self MESSAGE_UPDATE cannot loop back through the real Flume dispatch path", async () => {
  const diagnostics = new MemoryConnectorDiagnosticLog()
  const listener = new Listener({
    config: { id: "source", name: "events", type: "discord", botToken: "example-token" },
    diagnosticLog: diagnostics,
    flumeDeps: { WebSocket: Socket as unknown as NonNullable<FlumeRuntimeDeps["WebSocket"]> },
  })
  const delivered: string[] = []
  try {
    await listener.start(async (content) => {
      delivered.push(content)
    })
    await listener.flush()
    Socket.latest.emit({
      op: 0,
      t: "MESSAGE_UPDATE",
      s: 2,
      d: { id: "self", channel_id: "channel", author: { id: "BOT" }, content: "own update" },
    })
    Socket.latest.emit({
      op: 0,
      t: "MESSAGE_UPDATE",
      s: 3,
      d: { id: "other", channel_id: "channel", author: { id: "USER" }, content: "human update" },
    })
    await listener.flush()
    expect(delivered.map((content) => JSON.parse(content).id)).toEqual(["other"])
    expect(diagnostics.queryProcessed({ outcome: "skip:bot" })).toHaveLength(1)
    expect(diagnostics.queryProcessed({ outcome: "emitted" })).toHaveLength(1)
  } finally {
    await listener.stop()
  }
})
