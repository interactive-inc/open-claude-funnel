import { describe, expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import type {
  ScheduleConnectorConfig,
  ScheduleEntry,
} from "@/engine/connectors/schedule-connector-schema"
import { ScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { MemoryConnectorDiagnosticLog } from "@/gateway/diagnostic-log/memory-diagnostic-log"

const buildEntry = (overrides: Partial<ScheduleEntry> = {}): ScheduleEntry => ({
  id: "e1",
  cron: "* * * * *",
  prompt: "do it",
  enabled: true,
  catchupPolicy: "latest",
  ...overrides,
})

const buildConfig = (entries: ScheduleEntry[]): ScheduleConnectorConfig => ({
  id: "co-1",
  type: "schedule",
  name: "cron",
  entries,
})

const buildListener = (
  config: ScheduleConnectorConfig,
  now: Date,
): {
  listener: FunnelScheduleListener
  sent: { content: string; meta?: Record<string, string> }[]
} => {
  const fs = new MemoryFunnelFileSystem()
  const lastFiredStore = new ScheduleStateStore({ path: "/funnel/state.json", fs })
  const listener = new FunnelScheduleListener({
    config,
    lastFiredStore,
    logger: new NoopFunnelLogger(),
    now: () => now,
  })

  const sent: { content: string; meta?: Record<string, string> }[] = []

  return {
    listener,
    sent,
  }
}

describe("FunnelScheduleListener", () => {
  test("fires once when the current minute matches the cron", async () => {
    const config = buildConfig([buildEntry({ cron: "* * * * *" })])
    const { listener, sent } = buildListener(config, new Date("2026-01-01T00:00:00.000Z"))

    await listener.tick(async (content, meta) => {
      sent.push({ content, meta })
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.content).toBe("do it")
  })

  test("does not fire disabled entries", async () => {
    const config = buildConfig([buildEntry({ enabled: false })])
    const { listener, sent } = buildListener(config, new Date("2026-01-01T00:00:00.000Z"))

    await listener.tick(async (content, meta) => {
      sent.push({ content, meta })
    })

    expect(sent).toHaveLength(0)
  })

  test("respects skip catchup policy when the current minute does not match", async () => {
    const config = buildConfig([buildEntry({ cron: "5 * * * *", catchupPolicy: "skip" })])
    const { listener, sent } = buildListener(config, new Date("2026-01-01T00:00:00.000Z"))

    await listener.tick(async (content, meta) => {
      sent.push({ content, meta })
    })

    expect(sent).toHaveLength(0)
  })

  test("isAlive flips between start/stop", async () => {
    const config = buildConfig([buildEntry()])
    const { listener } = buildListener(config, new Date("2026-01-01T00:00:00.000Z"))

    expect(listener.isAlive()).toBe(false)
    await listener.start(async () => {})
    expect(listener.isAlive()).toBe(true)
    await listener.stop()
    expect(listener.isAlive()).toBe(false)
  })

  test("invokes onFired after each successful fire", async () => {
    const fired: { id: string; firedAt: Date }[] = []
    const config = buildConfig([buildEntry({ cron: "* * * * *" })])
    const fs = new MemoryFunnelFileSystem()
    const lastFiredStore = new ScheduleStateStore({ path: "/funnel/state.json", fs })
    const listener = new FunnelScheduleListener({
      config,
      lastFiredStore,
      logger: new NoopFunnelLogger(),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      onFired: (entry, firedAt) => {
        fired.push({ id: entry.id, firedAt })
      },
    })

    await listener.tick(async () => {})

    expect(fired).toHaveLength(1)
    expect(fired[0]?.id).toBe("e1")
    expect(fired[0]?.firedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z")
  })

  test("onFired errors do not abort the tick", async () => {
    const config = buildConfig([
      buildEntry({ id: "a", cron: "* * * * *" }),
      buildEntry({ id: "b", cron: "* * * * *" }),
    ])
    const fs = new MemoryFunnelFileSystem()
    const lastFiredStore = new ScheduleStateStore({ path: "/funnel/state.json", fs })
    const sent: string[] = []
    const listener = new FunnelScheduleListener({
      config,
      lastFiredStore,
      logger: new NoopFunnelLogger(),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      onFired: () => {
        throw new Error("boom")
      },
    })

    await listener.tick(async (content) => {
      sent.push(content)
    })

    expect(sent).toHaveLength(2)
  })

  test("persists lastFiredAt across constructor reloads (catch-up: latest)", async () => {
    const fs = new MemoryFunnelFileSystem()
    const path = "/funnel/state.json"
    const config = buildConfig([buildEntry({ cron: "* * * * *", catchupPolicy: "latest" })])

    const firstListener = new FunnelScheduleListener({
      config,
      lastFiredStore: new ScheduleStateStore({ path, fs }),
      logger: new NoopFunnelLogger(),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    })

    const sent1: number[] = []
    await firstListener.tick(async () => {
      sent1.push(1)
    })

    expect(sent1).toHaveLength(1)
    expect(fs.existsSync(path)).toBe(true)

    const secondListener = new FunnelScheduleListener({
      config,
      lastFiredStore: new ScheduleStateStore({ path, fs }),
      logger: new NoopFunnelLogger(),
      // same minute → should NOT fire again because the previous run already recorded it.
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    })

    const sent2: number[] = []
    await secondListener.tick(async () => {
      sent2.push(1)
    })

    expect(sent2).toHaveLength(0)
  })
})

describe("FunnelScheduleListener: diagnostic log", () => {
  const buildWith = (
    config: ScheduleConnectorConfig,
    now: Date,
    diagnosticLog: MemoryConnectorDiagnosticLog,
    channelId?: string,
  ): FunnelScheduleListener => {
    const fs = new MemoryFunnelFileSystem()
    const lastFiredStore = new ScheduleStateStore({ path: "/funnel/state.json", fs })

    return new FunnelScheduleListener({
      config,
      lastFiredStore,
      channelId,
      logger: new NoopFunnelLogger(),
      diagnosticLog,
      now: () => now,
    })
  }

  test("a firing entry records raw + emitted with eventId `${id}@${firedAt}`", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    const config = buildConfig([buildEntry({ id: "e1", cron: "* * * * *" })])
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = buildWith(config, now, diagnosticLog, "ch-uuid-1")

    await listener.tick(async () => {})

    const raws = diagnosticLog.queryRaw({})
    expect(raws).toHaveLength(1)
    expect(raws[0]?.type).toBe("schedule")
    expect(raws[0]?.connectorId).toBe("co-1")
    expect(raws[0]?.channelId).toBe("ch-uuid-1")
    expect(raws[0]?.eventId).toBe(`e1@${now.toISOString()}`)

    const processed = diagnosticLog.queryProcessed({})
    expect(processed).toHaveLength(1)
    expect(processed[0]?.outcome).toBe("emitted")
    expect(processed[0]?.eventId).toBe(raws[0]?.eventId ?? "")
  })

  test("records started on start() and stopped on stop()", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    const config = buildConfig([buildEntry({ cron: "* * * * *" })])
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = buildWith(config, now, diagnosticLog)

    await listener.start(async () => {})
    await listener.stop()

    const statuses = diagnosticLog.queryConnection({}).map((row) => row.status)
    expect(statuses).toContain("started")
    expect(statuses).toContain("stopped")
  })

  test("an invalid cron records an error connection row", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    // "bad" has one field, not five — matchCron throws on it.
    const config = buildConfig([buildEntry({ id: "e1", cron: "bad" })])
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = buildWith(config, now, diagnosticLog)

    await listener.tick(async () => {})

    const errors = diagnosticLog.queryConnection({ status: "error" })
    expect(errors).toHaveLength(1)
    expect(errors[0]?.detail).toContain("invalid cron")
    // An invalid cron neither fires nor records a processed verdict.
    expect(diagnosticLog.queryProcessed({})).toHaveLength(0)
  })

  test("records nothing and does not throw when no diagnosticLog is injected", async () => {
    const now = new Date("2026-01-01T00:00:00.000Z")
    const config = buildConfig([buildEntry({ cron: "* * * * *" })])
    const fs = new MemoryFunnelFileSystem()
    const lastFiredStore = new ScheduleStateStore({ path: "/funnel/state.json", fs })
    const listener = new FunnelScheduleListener({
      config,
      lastFiredStore,
      logger: new NoopFunnelLogger(),
      now: () => now,
    })

    // Exercising the record paths; absence of a throw is the assertion.
    await listener.start(async () => {})
    await listener.stop()
  })
})
