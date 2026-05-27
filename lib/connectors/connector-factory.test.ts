import { beforeEach, describe, expect, mock, test } from "bun:test"
import { FunnelConnectorFactory } from "@/connectors/connector-factory"
import type { SlackConnectorConfig } from "@/connectors/slack-connector-schema"
import { MemoryConnectorDiagnosticLog } from "@/gateway/memory-connector-diagnostic-log"

// Mock Bolt so createListener(...).start() runs without a real socket. The
// factory test only needs the listener to reach its first recordConnection.
mock.module("@slack/bolt", () => {
  class FakeApp {
    use = mock(() => {})
    error = mock(() => {})
    action = mock(() => {})
    start = mock(() => Promise.resolve(undefined))
    stop = mock(() => Promise.resolve(undefined))
    client = {
      auth: { test: mock(() => Promise.resolve({ user_id: "U", bot_id: "B" })) },
      reactions: { add: mock(() => Promise.resolve({ ok: true })) },
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
