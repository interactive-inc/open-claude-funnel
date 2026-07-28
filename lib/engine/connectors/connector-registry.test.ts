import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import type { ScheduleConnectorConfig } from "@/engine/connectors/schedule-connector-schema"
import { slackConnector } from "@/engine/connectors/slack-connector"
import type { SlackConnectorConfig } from "@/engine/connectors/slack-connector-schema"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

const slackConfig: SlackConnectorConfig = {
  id: "co-1",
  type: "slack",
  name: "ops",
  botToken: "xoxb-x",
  appToken: "xapp-x",
  minify: true,
}

let diagnosticLog: MemoryConnectorDiagnosticLog

beforeEach(() => {
  diagnosticLog = new MemoryConnectorDiagnosticLog()
})

describe("FunnelConnectorRegistry diagnosticLog wiring", () => {
  // Capture the deps the registry hands to the descriptor without going
  // through the real Flume-backed listener. A capture descriptor isolates
  // exactly what the registry passes — useful when the test is about the
  // registry seam itself, not about Flume's connect path.
  const captureDescriptor = (recorded: {
    deps?: { diagnosticLog?: unknown; channelId?: string; signal?: AbortSignal }
  }) => ({
    type: "slack",
    toolExposed: true,
    createListener(
      _config: unknown,
      deps: { diagnosticLog?: unknown; channelId: string; signal?: AbortSignal },
    ) {
      recorded.deps = deps
      return {
        start: async () => {},
        stop: async () => {},
        isAlive: () => true,
      } as unknown as ReturnType<typeof slackConnector>["createListener"] extends (
        ...args: unknown[]
      ) => infer R
        ? R
        : never
    },
    createAdapter: null,
    toolName: () => "slack",
    secretTokens: () => [],
    buildConfig: (input: Record<string, unknown>) => input as never,
    applyUpdate: (config: unknown) => config as never,
    operations: {},
  })

  test("threads the diagnosticLog into the Slack listener it builds", () => {
    const recorded: { deps?: { diagnosticLog?: unknown; channelId?: string } } = {}
    const registry = new FunnelConnectorRegistry({
      descriptors: [captureDescriptor(recorded)],
      diagnosticLog,
    })

    registry.createListener("ch-uuid-1", slackConfig)

    expect(recorded.deps?.diagnosticLog).toBe(diagnosticLog)
    expect(recorded.deps?.channelId).toBe("ch-uuid-1")
  })

  test("threads a no diagnosticLog through cleanly when the host omits one", () => {
    const recorded: { deps?: { diagnosticLog?: unknown } } = {}
    const registry = new FunnelConnectorRegistry({
      descriptors: [captureDescriptor(recorded)],
    })

    registry.createListener("ch-uuid-1", slackConfig)

    expect(recorded.deps?.diagnosticLog).toBeUndefined()
  })

  test("forwards the shared AbortSignal to every listener it builds", () => {
    const recorded: { deps?: { signal?: AbortSignal } } = {}
    const controller = new AbortController()

    const registry = new FunnelConnectorRegistry({
      descriptors: [captureDescriptor(recorded)],
      signal: controller.signal,
    })

    registry.createListener("ch-uuid-1", slackConfig)

    expect(recorded.deps?.signal).toBe(controller.signal)
  })

  test("throws for a connector type whose descriptor was not registered", () => {
    const registry = new FunnelConnectorRegistry({ descriptors: [] })

    expect(() => registry.createListener("ch-uuid-1", slackConfig)).toThrow(
      /unknown connector type/,
    )
  })
})

describe("FunnelConnectorRegistry → FlumeSlackSource integration", () => {
  // Flume 0.7+ resolves `globalThis.WebSocket` on every
  // `createFlumeDefaultDeps()` call, so a per-test patch reaches all the way
  // into the Slack source. With 0.6 this was impossible — the constructor
  // was cached at module load — and the whole connected-path was untestable.

  const originalFetch = globalThis.fetch
  const originalWebSocket = globalThis.WebSocket

  type WsListener = (event: { data?: unknown; code?: number; reason?: string }) => void

  class FakeWebSocket {
    static OPEN = 1
    static CLOSED = 3
    readyState: number = FakeWebSocket.OPEN
    url: string
    private readonly listeners: Record<string, WsListener[]> = {}

    constructor(url: string | URL) {
      this.url = String(url)
      // Defer hello to the next tick so the source has time to subscribe.
      setTimeout(() => {
        for (const handler of this.listeners["message"] ?? []) {
          handler({ data: JSON.stringify({ type: "hello" }) })
        }
      }, 0)
    }

    addEventListener(type: string, handler: WsListener): void {
      if (!this.listeners[type]) this.listeners[type] = []
      this.listeners[type]!.push(handler)
    }

    removeEventListener(): void {}

    send(): void {}

    close(): void {
      this.readyState = FakeWebSocket.CLOSED
      for (const handler of this.listeners["close"] ?? []) {
        handler({ code: 1000, reason: "" })
      }
    }
  }

  beforeEach(() => {
    diagnosticLog = new MemoryConnectorDiagnosticLog()

    globalThis.fetch = (async (url: string | URL) => {
      const target = String(url)
      if (target === "https://slack.com/api/auth.test") {
        return new Response(JSON.stringify({ ok: true, user_id: "U", bot_id: "B" }), {
          status: 200,
        })
      }
      if (target === "https://slack.com/api/apps.connections.open") {
        return new Response(JSON.stringify({ ok: true, url: "wss://slack.example/ws" }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch

    globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    globalThis.WebSocket = originalWebSocket
  })

  test("started → connected path records both rows under the diagnosticLog the registry injected", async () => {
    const registry = new FunnelConnectorRegistry({
      descriptors: [slackConnector()],
      diagnosticLog,
    })

    const listener = registry.createListener("ch-uuid-1", slackConfig)
    await listener.start(async () => {})
    // The fake WS dispatches "hello" on next tick, after which Flume's
    // source flips status to "connected" and our listener records the row.
    await new Promise((resolve) => setTimeout(resolve, 5))

    const statuses = diagnosticLog.queryConnection({ type: "slack" }).map((row) => row.status)

    expect(statuses).toContain("started")
    expect(statuses).toContain("connected")
    expect(diagnosticLog.queryConnection({})[0]?.connectorId).toBe("co-1")

    await listener.stop()
  })
})

describe("FunnelConnectorRegistry adapter dispatch", () => {
  const scheduleConfig: ScheduleConnectorConfig = {
    id: "co-2",
    type: "schedule",
    name: "cron",
    entries: [],
  }

  test("builds an adapter for a callable type and returns null for schedule", () => {
    const registry = new FunnelConnectorRegistry({
      descriptors: [slackConnector(), scheduleConnector()],
    })

    expect(registry.createAdapter(slackConfig)).not.toBeNull()
    expect(registry.createAdapter(scheduleConfig)).toBeNull()
  })
})
