import { describe, expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import type {
  CronScheduleEntry,
  ScheduleConnectorConfig,
  ScheduleEntry,
} from "@/engine/connectors/schedule-connector-schema"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

const buildEntry = (overrides: Partial<CronScheduleEntry> = {}): CronScheduleEntry => ({
  id: "e1",
  kind: "cron",
  cron: "* * * * *",
  prompt: "do it",
  enabled: true,
  catchupPolicy: "latest",
  ...overrides,
})

const buildOnceEntry = (
  overrides: Partial<Extract<ScheduleEntry, { kind: "once" }>> = {},
): Extract<ScheduleEntry, { kind: "once" }> => ({
  id: "once-1",
  kind: "once",
  runAt: "2026-01-01T09:00:30.000Z",
  prompt: "do it once",
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
  const lastFiredStore = new FunnelScheduleStateStore({ path: "/funnel/state.json", fs })
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
    const lastFiredStore = new FunnelScheduleStateStore({ path: "/funnel/state.json", fs })
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
    const lastFiredStore = new FunnelScheduleStateStore({ path: "/funnel/state.json", fs })
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

  test("tick failure does not stop the next timer from scheduling", async () => {
    const config = buildConfig([buildEntry({ cron: "* * * * *" })])
    const fs = new MemoryFunnelFileSystem()
    const lastFiredStore = new FunnelScheduleStateStore({ path: "/funnel/state.json", fs })
    let tickCount = 0
    const listener = new FunnelScheduleListener({
      config,
      lastFiredStore,
      logger: new NoopFunnelLogger(),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    })

    const throwOnce: Parameters<typeof listener.start>[0] = async () => {
      tickCount++
      if (tickCount === 1) throw new Error("notify boom")
    }

    await listener.start(throwOnce)

    expect(listener.isAlive()).toBe(true)

    await listener.stop()
  })

  test("isAlive returns true while ticks are scheduled", async () => {
    const config = buildConfig([buildEntry({ cron: "* * * * *" })])
    const { listener } = buildListener(config, new Date("2026-01-01T00:00:00.000Z"))

    expect(listener.isAlive()).toBe(false)

    await listener.start(async () => {})

    expect(listener.isAlive()).toBe(true)

    await listener.stop()

    expect(listener.isAlive()).toBe(false)
  })

  test("persists lastFiredAt across constructor reloads (catch-up: latest)", async () => {
    const fs = new MemoryFunnelFileSystem()
    const path = "/funnel/state.json"
    const config = buildConfig([buildEntry({ cron: "* * * * *", catchupPolicy: "latest" })])

    const firstListener = new FunnelScheduleListener({
      config,
      lastFiredStore: new FunnelScheduleStateStore({ path, fs }),
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
      lastFiredStore: new FunnelScheduleStateStore({ path, fs }),
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

  test("catches up from entry creation time on the first daemon tick", async () => {
    const config = buildConfig([
      buildEntry({
        cron: "0 9 * * *",
        createdAt: "2026-01-01T08:30:00.000Z",
      }),
    ])
    const { listener, sent } = buildListener(config, new Date("2026-01-01T10:00:00.000Z"))

    await listener.tick(async (content, meta) => {
      sent.push({ content, meta })
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.meta?.fired_at).toBe("2026-01-01T09:00:00.000Z")
    expect(sent[0]?.meta?.catchup).toBe("true")
  })

  test("fires a native once entry no earlier than runAt and never repeats it", async () => {
    const fs = new MemoryFunnelFileSystem()
    const path = "/funnel/state.json"
    const config = buildConfig([buildOnceEntry()])
    const clock = { now: new Date("2026-01-01T09:00:00.000Z") }
    const listener = new FunnelScheduleListener({
      config,
      lastFiredStore: new FunnelScheduleStateStore({ path, fs }),
      now: () => clock.now,
    })
    const sent: Array<{ content: string; meta?: Record<string, string> }> = []

    await listener.tick(async (content, meta) => {
      sent.push({ content, meta })
    })
    expect(sent).toHaveLength(0)

    clock.now = new Date("2026-01-01T09:01:00.000Z")
    await listener.tick(async (content, meta) => {
      sent.push({ content, meta })
    })
    await listener.tick(async (content, meta) => {
      sent.push({ content, meta })
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]?.content).toBe("do it once")
    expect(sent[0]?.meta?.schedule_kind).toBe("once")
    expect(sent[0]?.meta?.run_at).toBe("2026-01-01T09:00:30.000Z")
    expect(sent[0]?.meta?.fired_at).toBe("2026-01-01T09:00:30.000Z")

    const reloaded = new FunnelScheduleListener({
      config,
      lastFiredStore: new FunnelScheduleStateStore({ path, fs }),
      now: () => clock.now,
    })

    await reloaded.tick(async (content, meta) => {
      sent.push({ content, meta })
    })
    expect(sent).toHaveLength(1)
  })

  test("a missed once entry with skip policy is consumed without firing", async () => {
    const config = buildConfig([
      buildOnceEntry({
        runAt: "2026-01-01T09:00:00.000Z",
        catchupPolicy: "skip",
      }),
    ])
    const { listener, sent } = buildListener(config, new Date("2026-01-01T09:02:00.000Z"))

    await listener.tick(async (content, meta) => {
      sent.push({ content, meta })
    })
    await listener.tick(async (content, meta) => {
      sent.push({ content, meta })
    })

    expect(sent).toHaveLength(0)
  })

  test("prunes state for entries removed from the connector", async () => {
    const fs = new MemoryFunnelFileSystem()
    const path = "/funnel/state.json"
    const store = new FunnelScheduleStateStore({ path, fs })
    store.save(new Map([["removed", new Date("2026-01-01T00:00:00.000Z")]]))
    const listener = new FunnelScheduleListener({
      config: buildConfig([]),
      lastFiredStore: store,
      now: () => new Date("2026-01-01T01:00:00.000Z"),
    })

    await listener.tick(async () => {})

    expect(store.load().has("removed")).toBe(false)
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
    const lastFiredStore = new FunnelScheduleStateStore({ path: "/funnel/state.json", fs })

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
    const lastFiredStore = new FunnelScheduleStateStore({ path: "/funnel/state.json", fs })
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
