import { beforeEach, describe, expect, test } from "vitest"
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
  // through the real Flume-backed listener. Flume 0.6 caches
  // `globalThis.WebSocket` at module load, so a per-test stub can't
  // intercept it — we'd be testing Flume's connect path, not the registry
  // seam. A capture descriptor isolates exactly what the registry passes.
  const captureDescriptor = (recorded: { deps?: { diagnosticLog?: unknown; channelId?: string; signal?: AbortSignal } }) => ({
    type: "slack",
    toolExposed: true,
    createListener(_config: unknown, deps: { diagnosticLog?: unknown; channelId: string; signal?: AbortSignal }) {
      recorded.deps = deps
      return {
        start: async () => {},
        stop: async () => {},
        isAlive: () => true,
      } as unknown as ReturnType<typeof slackConnector>["createListener"] extends (...args: unknown[]) => infer R
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
