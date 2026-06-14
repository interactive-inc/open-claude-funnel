import { beforeEach, describe, expect, test, vi } from "vitest"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import type { ScheduleConnectorConfig } from "@/engine/connectors/schedule-connector-schema"
import { slackConnector } from "@/engine/connectors/slack-connector"
import type { SlackConnectorConfig } from "@/engine/connectors/slack-connector-schema"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

vi.mock("@slack/bolt", () => {
  class FakeApp {
    use = vi.fn()
    error = vi.fn()
    action = vi.fn()
    start = vi.fn(() => Promise.resolve(undefined))
    stop = vi.fn(() => Promise.resolve(undefined))
    client = {
      auth: { test: vi.fn(() => Promise.resolve({ user_id: "U", bot_id: "B" })) },
      reactions: { add: vi.fn(() => Promise.resolve({ ok: true })) },
    }
  }

  class FakeSocketModeReceiver {
    client = { on: vi.fn() }
  }

  return { LogLevel: { ERROR: "ERROR" }, App: FakeApp, SocketModeReceiver: FakeSocketModeReceiver }
})

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
  test("threads the diagnosticLog into the Slack listener it builds", async () => {
    const registry = new FunnelConnectorRegistry({
      descriptors: [slackConnector()],
      diagnosticLog,
    })

    const listener = registry.createListener("ch-uuid-1", slackConfig)
    await listener.start(async () => {})

    // If the registry/descriptor failed to pass diagnosticLog through, the
    // listener's recordConnection would no-op and this stays empty.
    const rows = diagnosticLog.queryConnection({})
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]?.connectorId).toBe("co-1")
    expect(rows[0]?.channelId).toBe("ch-uuid-1")
    expect(rows.map((row) => row.status)).toContain("connected")
  })

  test("a listener built without a diagnosticLog records nothing (no-op)", async () => {
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
