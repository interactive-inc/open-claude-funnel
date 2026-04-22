import { describe, expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/modules/connectors/funnel-schedule-listener"
import { FunnelScheduleStore } from "@/modules/connectors/funnel-schedule-store"
import { ScheduleLastFiredStore } from "@/modules/connectors/schedule-last-fired-store"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"

const setup = () => {
  const fs = new MemoryFunnelFileSystem()
  const store = new FunnelScheduleStore({ fs, dir: "/fake" })
  store.add({ type: "schedule", name: "cron-a", entries: [] })
  const lastFiredStore = new ScheduleLastFiredStore({ connector: "cron-a", fs, dir: "/fake" })
  return { fs, store, lastFiredStore }
}

describe("FunnelScheduleListener", () => {
  test("tick fires for matching cron entries", async () => {
    const { store, lastFiredStore } = setup()
    const entry = store.addEntry("cron-a", {
      cron: "15 10 * * *",
      prompt: "morning check",
      enabled: true,
    })

    const now = new Date(2026, 3, 22, 10, 15)
    const listener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => now,
    })

    const fired: Array<{ content: string; meta?: Record<string, string> }> = []
    await listener.tick(async (content, meta) => {
      fired.push({ content, meta })
    })

    expect(fired).toHaveLength(1)
    expect(fired[0]?.content).toBe("morning check")
    expect(fired[0]?.meta?.schedule_id).toBe(entry.id)
    expect(fired[0]?.meta?.catchup).toBeUndefined()
  })

  test("tick skips non-matching and disabled entries", async () => {
    const { store, lastFiredStore } = setup()
    store.addEntry("cron-a", { cron: "0 9 * * *", prompt: "a", enabled: true })
    store.addEntry("cron-a", { cron: "15 10 * * *", prompt: "disabled", enabled: false })

    const now = new Date(2026, 3, 22, 10, 15)
    const listener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => now,
    })

    const fired: string[] = []
    await listener.tick(async (content) => {
      fired.push(content)
    })

    expect(fired).toEqual([])
  })

  test("does not re-fire within the same minute", async () => {
    const { store, lastFiredStore } = setup()
    store.addEntry("cron-a", { cron: "* * * * *", prompt: "every-min", enabled: true })

    const now = new Date(2026, 3, 22, 10, 15)
    const listener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => now,
    })

    const fired: string[] = []
    const notify = async (content: string) => {
      fired.push(content)
    }

    await listener.tick(notify)
    await listener.tick(notify)

    expect(fired).toHaveLength(1)
  })

  test("catches up the most recent missed match after downtime", async () => {
    const { store, lastFiredStore } = setup()
    store.addEntry("cron-a", { cron: "*/5 * * * *", prompt: "every-5", enabled: true })

    const initial = new Date(2026, 3, 22, 10, 0)
    const listener0 = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => initial,
    })
    const firedInitial: string[] = []
    await listener0.tick(async (c) => {
      firedInitial.push(c)
    })
    expect(firedInitial).toHaveLength(1)

    const after = new Date(2026, 3, 22, 10, 37)
    const listener1 = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => after,
    })
    const firedAfter: Array<{ content: string; meta?: Record<string, string> }> = []
    await listener1.tick(async (c, m) => {
      firedAfter.push({ content: c, meta: m })
    })

    expect(firedAfter).toHaveLength(1)
    expect(firedAfter[0]?.meta?.catchup).toBe("true")
    const firedAt = firedAfter[0]?.meta?.fired_at
    expect(firedAt).toBeTruthy()
    expect(new Date(firedAt ?? "").getMinutes()).toBe(35)
  })

  test("first-ever run does not catch up historical matches", async () => {
    const { store, lastFiredStore } = setup()
    store.addEntry("cron-a", { cron: "0 9 * * *", prompt: "morning", enabled: true })

    const now = new Date(2026, 3, 22, 14, 0)
    const listener = new FunnelScheduleListener({
      config: { type: "schedule", name: "cron-a", entries: [] },
      store,
      lastFiredStore,
      now: () => now,
    })

    const fired: string[] = []
    await listener.tick(async (c) => {
      fired.push(c)
    })

    expect(fired).toEqual([])
  })
})
