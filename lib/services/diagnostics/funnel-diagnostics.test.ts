import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { rmSync } from "node:fs"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteConnectorDiagnosticLog } from "@/gateway/diagnostic-log/sqlite-diagnostic-log"
import { FunnelDiagnostics } from "@/services/diagnostics/funnel-diagnostics"
import type { ChannelConfig } from "@/engine/settings/settings-schema"

const isBun = typeof globalThis.Bun !== "undefined"

let dir = ""
const originalFetch = globalThis.fetch

const channel: ChannelConfig = {
  id: "ch-1",
  name: "ops",
  delivery: "fanout",
  connectors: [
    {
      id: "co-1",
      name: "slack",
      type: "slack",
      botToken: "xoxb-test",
      appToken: "xapp-test",
      minify: true,
    },
  ],
}

const buildDiagnostics = () =>
  new FunnelDiagnostics({
    channels: { list: () => [channel] },
    gateway: { getStatus: () => ({ running: true, pid: 123, port: 4567 }) },
    gatewayToken: { read: () => null },
    publisher: {
      publish: async () => ({ state: "ok", offset: 1 }),
    },
    tmpDir: dir,
  })

const seedProcessed = (payload: Record<string, unknown>, eventId: string): void => {
  const log = new SqliteConnectorDiagnosticLog({
    rawPath: join(dir, "connector-raw.db"),
    processedPath: join(dir, "connector-processed.db"),
    connectionPath: join(dir, "connector-connection.db"),
  })

  log.recordProcessed({
    eventId,
    type: "slack",
    connectorId: "co-1",
    channelId: "ch-1",
    outcome: "emitted",
    payload: JSON.stringify(payload),
  })
  log.recordRaw({
    eventId,
    type: "slack",
    connectorId: "co-1",
    channelId: "ch-1",
    payload: JSON.stringify(payload),
  })
  log.recordConnection({
    type: "slack",
    connectorId: "co-1",
    channelId: "ch-1",
    status: "connected",
    detail: "",
  })
  log.close()
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "funnel-diagnostics-"))
  globalThis.fetch = (async () =>
    Response.json({
      pid: 123,
      uptimeMs: 1000,
      clients: [{ channel: "ch-1", channelName: "ops", connectors: ["slack"] }],
      listeners: [
        {
          channelName: "ops",
          name: "slack",
          type: "slack",
          alive: true,
          events: 2,
          errors: 0,
          lastEventAt: "2026-06-10T06:30:52.258Z",
        },
      ],
    })) as unknown as typeof fetch
})

afterEach(() => {
  globalThis.fetch = originalFetch
  rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!isBun)("FunnelDiagnostics", () => {
  test("warns when Slack only delivered app_mention events", async () => {
    seedProcessed({ type: "app_mention", text: "<@U_BOT> ping" }, "ev-1")

    const report = await buildDiagnostics().diagnose("ops")

    expect(report?.diagnosis.status).toBe("warn")
    expect(report?.diagnosis.message).toContain("only delivering app_mention")
    expect(report?.diagnosis.nextActions[0]).toContain("message.channels")
  })

  test("stays healthy once Slack message events are present", async () => {
    seedProcessed({ type: "app_mention", text: "<@U_BOT> ping" }, "ev-1")
    seedProcessed({ type: "message", text: "thread follow-up" }, "ev-2")

    const report = await buildDiagnostics().diagnose("ops")

    expect(report?.diagnosis.status).toBe("ok")
  })
})
