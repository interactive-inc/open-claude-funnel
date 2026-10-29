import { expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import type { CronScheduleEntry } from "@/engine/connectors/schedule-connector-schema"

const entry = (id: string): CronScheduleEntry => ({
  id,
  kind: "cron",
  cron: "* * * * *",
  prompt: id,
  enabled: true,
  catchupPolicy: "all",
  createdAt: "2026-01-01T00:00:00.000Z",
})

test("a failed later entry does not replay earlier successful deliveries", async () => {
  const state = new FunnelScheduleStateStore()
  const listener = new FunnelScheduleListener({
    config: {
      id: "schedule",
      name: "schedule",
      type: "schedule",
      entries: [entry("a"), entry("b")],
    },
    lastFiredStore: state,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  })
  const delivered: string[] = []
  await expect(
    listener.tick(async (content) => {
      if (content === "b") throw new Error("delivery failed")
      delivered.push(content)
    }),
  ).rejects.toThrow("delivery failed")
  await listener.tick(async (content) => {
    delivered.push(content)
  })
  expect(delivered).toEqual(["a", "b"])
})

test("a partial catch-up checkpoints each delivered minute before retry", async () => {
  const state = new FunnelScheduleStateStore()
  const listener = new FunnelScheduleListener({
    config: { id: "schedule", name: "schedule", type: "schedule", entries: [entry("a")] },
    lastFiredStore: state,
    now: () => new Date("2026-01-01T00:02:00.000Z"),
  })
  const delivered: string[] = []
  await expect(
    listener.tick(async (_content, meta) => {
      if (meta?.fired_at === "2026-01-01T00:01:00.000Z") throw new Error("delivery failed")
      delivered.push(meta!.fired_at!)
    }),
  ).rejects.toThrow("delivery failed")
  await listener.tick(async (_content, meta) => {
    delivered.push(meta!.fired_at!)
  })
  expect(delivered).toEqual([
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:01:00.000Z",
    "2026-01-01T00:02:00.000Z",
  ])
})

test("stop from a delivery prevents remaining catch-up and entries from firing", async () => {
  const listener = new FunnelScheduleListener({
    config: {
      id: "schedule",
      name: "schedule",
      type: "schedule",
      entries: [entry("a"), entry("b")],
    },
    lastFiredStore: new FunnelScheduleStateStore(),
    now: () => new Date("2026-01-01T00:02:00.000Z"),
  })
  const delivered: string[] = []
  await listener.start(async (content) => {
    delivered.push(content)
    await listener.stop()
  })
  expect(delivered).toEqual(["a"])
  expect(listener.isAlive()).toBe(false)
  await listener.tick(async (content) => {
    delivered.push(content)
  })
  expect(delivered).toEqual(["a"])
})

test("overlapping ticks do not deliver the same due entry twice", async () => {
  const listener = new FunnelScheduleListener({
    config: { id: "schedule", name: "schedule", type: "schedule", entries: [entry("a")] },
    lastFiredStore: new FunnelScheduleStateStore(),
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  })
  const delivered: string[] = []
  const notify = async (content: string) => {
    delivered.push(content)
    await Promise.resolve()
  }
  await Promise.all([listener.tick(notify), listener.tick(notify)])
  expect(delivered).toEqual(["a"])
})

test("sparse cron catch-up reaches the current due time after more than a day", async () => {
  const state = new FunnelScheduleStateStore()
  state.save(new Map([["a", new Date(2025, 11, 29, 0, 0)]]))
  const now = new Date(2026, 0, 5, 0, 0)
  const listener = new FunnelScheduleListener({
    config: {
      id: "schedule",
      name: "schedule",
      type: "schedule",
      entries: [
        {
          ...entry("a"),
          cron: "0 0 * * 1",
          createdAt: new Date(2025, 11, 1).toISOString(),
        },
      ],
    },
    lastFiredStore: state,
    now: () => now,
  })
  const delivered: string[] = []
  await listener.tick(async (_content, meta) => {
    delivered.push(meta!.fired_at!)
  })
  expect(delivered).toEqual([now.toISOString()])
})

test("all catch-up delivers only the latest 24 hours in chronological order", async () => {
  const state = new FunnelScheduleStateStore()
  const now = new Date("2026-01-05T00:00:00.000Z")
  const listener = new FunnelScheduleListener({
    config: { id: "schedule", name: "schedule", type: "schedule", entries: [entry("a")] },
    lastFiredStore: state,
    now: () => now,
  })
  const delivered: string[] = []
  await listener.tick(async (_content, meta) => {
    delivered.push(meta!.fired_at!)
  })
  expect(delivered).toHaveLength(1440)
  expect(delivered[0]).toBe(new Date(now.getTime() - 1439 * 60_000).toISOString())
  expect(delivered.at(-1)).toBe(now.toISOString())
  await listener.tick(async (_content, meta) => {
    delivered.push(meta!.fired_at!)
  })
  expect(delivered).toHaveLength(1440)
})

test("a host callback can reenter tick without deadlock or duplicate delivery", async () => {
  const delivered: string[] = []
  const state = new FunnelScheduleStateStore()
  const listener = new FunnelScheduleListener({
    config: { id: "schedule", name: "schedule", type: "schedule", entries: [entry("a")] },
    lastFiredStore: state,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    onFired: async () => {
      expect(state.load().get("a")?.toISOString()).toBe("2026-01-01T00:00:00.000Z")
      await listener.tick(async (content) => {
        delivered.push(content)
      })
    },
  })
  await listener.tick(async (content) => {
    delivered.push(content)
  })
  expect(delivered).toEqual(["a"])
})
