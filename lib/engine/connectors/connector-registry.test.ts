import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import type { ScheduleConnectorConfig } from "@/engine/connectors/schedule-connector-schema"
import { slackConnector } from "@/engine/connectors/slack-connector"
import type { SlackConnectorConfig } from "@/engine/connectors/slack-connector-schema"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

// The Flume-backed Slack listener calls `auth.test` over plain `fetch` to
// learn its own bot/user id. Mock the global so the listener sees a
// successful auth response and records a "connected" connection row.
const mockSlackApi = (overrides: Partial<{ authTest: unknown; connectionsOpen: unknown }> = {}) => {
  const authTest = overrides.authTest ?? { ok: true, user_id: "U", bot_id: "B" }
  const connectionsOpen = overrides.connectionsOpen ?? { ok: true, url: "wss://slack.example/ws" }

  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const target = String(url)

    if (target === "https://slack.com/api/auth.test") {
      return new Response(JSON.stringify(authTest), { status: 200 })
    }

    if (target === "https://slack.com/api/apps.connections.open") {
      return new Response(JSON.stringify(connectionsOpen), { status: 200 })
    }

    if (target.startsWith("wss://")) {
      // Should not happen in tests; the listener does not open a real WS here.
      return new Response("not found", { status: 404 })
    }

    // Fallback for any other Slack API call (e.g. reactions.add).
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  })

  globalThis.fetch = fetchMock as unknown as typeof fetch

  // Stub the WebSocket constructor so Flume's Slack source can be constructed
  // without a real socket. The listener calls source.start(), which triggers
  // obtainSlackUrl + WebSocket construction; we want start() to resolve
  // without actually opening a connection. The simplest path is to stub a
  // WebSocket that immediately calls the close handler, but for the
  // diagnosticLog wiring test we just need start() not to throw.
  class FakeWebSocket {
    static OPEN = 1
    static CLOSED = 3
    readyState = 1
    url: string
    listeners: Record<string, Array<(ev: unknown) => void>> = {}

    constructor(url: string | URL) {
      this.url = String(url)
      // Immediately deliver a Slack "hello" so FlumeSlackSocketMode.connect()
      // resolves and source.start() completes — the diagnosticLog wiring test
      // does not exercise real socket semantics.
      setTimeout(() => {
        const fns = this.listeners["message"] ?? []
        for (const fn of fns) fn({ data: JSON.stringify({ type: "hello" }) })
      }, 0)
    }

    addEventListener(type: string, fn: (ev: unknown) => void): void {
      if (!this.listeners[type]) this.listeners[type] = []
      this.listeners[type]!.push(fn)
    }

    removeEventListener(): void {}

    send(): void {}

    close(): void {
      const fns = this.listeners["close"] ?? []
      for (const fn of fns) fn({ code: 1000, reason: "" })
    }
  }

  globalThis.WebSocket = FakeWebSocket as unknown as typeof WebSocket

  return { fetchMock }
}

const slackConfig: SlackConnectorConfig = {
  id: "co-1",
  type: "slack",
  name: "ops",
  botToken: "xoxb-x",
  appToken: "xapp-x",
  minify: true,
}

let diagnosticLog: MemoryConnectorDiagnosticLog
let originalFetch: typeof fetch
let originalWebSocket: typeof WebSocket

beforeEach(() => {
  diagnosticLog = new MemoryConnectorDiagnosticLog()
  originalFetch = globalThis.fetch
  originalWebSocket = globalThis.WebSocket
})

afterEach(() => {
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalWebSocket
})

describe("FunnelConnectorRegistry diagnosticLog wiring", () => {
  test("threads the diagnosticLog into the Slack listener it builds", async () => {
    mockSlackApi()

    const registry = new FunnelConnectorRegistry({
      descriptors: [slackConnector()],
      diagnosticLog,
    })

    const listener = registry.createListener("ch-uuid-1", slackConfig)
    await listener.start(async () => {})

    // If the registry/descriptor failed to pass diagnosticLog through, the
    // listener's recordConnection would no-op and this stays empty. The
    // listener records at least "started" and "connected" rows.
    const rows = diagnosticLog.queryConnection({})
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]?.connectorId).toBe("co-1")
    expect(rows[0]?.channelId).toBe("ch-uuid-1")
  })

  test("a listener built without a diagnosticLog records nothing (no-op)", async () => {
    mockSlackApi()

    const registry = new FunnelConnectorRegistry({ descriptors: [slackConnector()] })

    const listener = registry.createListener("ch-uuid-1", slackConfig)

    // Absence of a throw is the assertion: recordConnection is a silent no-op.
    await listener.start(async () => {})
  })

  test("throws for a connector type whose descriptor was not registered", () => {
    const registry = new FunnelConnectorRegistry({ descriptors: [] })

    expect(() => registry.createListener("ch-uuid-1", slackConfig)).toThrow(/unknown connector type/)
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
