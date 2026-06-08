import { beforeEach, describe, expect, test, vi } from "vitest"
import { FunnelConnectorFactory } from "@/engine/connectors/connector-factory"
import type { SlackConnectorConfig } from "@/engine/connectors/slack-connector-schema"
import { MemoryConnectorDiagnosticLog } from "@/gateway/diagnostic-log/memory-diagnostic-log"

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

  return { LogLevel: { ERROR: "ERROR" }, App: FakeApp }
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

describe("FunnelConnectorFactory diagnosticLog wiring", () => {
  test("threads the diagnosticLog into the Slack listener it builds", async () => {
    const factory = new FunnelConnectorFactory({ diagnosticLog })

    const listener = factory.createListener("ch-uuid-1", slackConfig)
    await listener.start(async () => {})

    // If the factory failed to pass diagnosticLog through, the listener's
    // recordConnection would no-op and this stays empty.
    const rows = diagnosticLog.queryConnection({})
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]?.connectorId).toBe("co-1")
    expect(rows[0]?.channelId).toBe("ch-uuid-1")
    expect(rows.map((row) => row.status)).toContain("connected")
  })

  test("a listener built without a diagnosticLog records nothing (no-op)", async () => {
    const factory = new FunnelConnectorFactory({})

    const listener = factory.createListener("ch-uuid-1", slackConfig)

    // Absence of a throw is the assertion: recordConnection is a silent no-op.
    await listener.start(async () => {})
  })
})
