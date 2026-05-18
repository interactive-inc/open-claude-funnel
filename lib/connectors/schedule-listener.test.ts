import { describe, expect, test } from "vitest"
import { FunnelScheduleListener } from "@/connectors/schedule-listener"
import type { ScheduleConnectorConfig, ScheduleEntry } from "@/connectors/schedule-connector-schema"
import { ScheduleStateStore } from "@/connectors/schedule-state-store"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"

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
