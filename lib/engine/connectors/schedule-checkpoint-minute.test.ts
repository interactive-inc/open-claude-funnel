import { expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import type { ScheduleCatchupPolicy } from "@/engine/connectors/schedule-connector-schema"

const create = (state: FunnelScheduleStateStore, policy: ScheduleCatchupPolicy, now: () => Date) =>
  new FunnelScheduleListener({
    config: {
      id: "source",
      name: "source",
      type: "schedule",
      entries: [
        {
          id: "entry",
          kind: "cron",
          cron: "* * * * *",
          prompt: "input",
          enabled: true,
          catchupPolicy: policy,
        },
      ],
    },
    lastFiredStore: state,
    now,
  })

for (const policy of ["all", "latest", "skip"] as const) {
  for (const checkpoint of ["00:00:30.123", "00:00:00.001"]) {
    test(`${policy} resumes at the next cron minute after checkpoint ${checkpoint}`, async () => {
      const state = new FunnelScheduleStateStore()
      state.save(new Map([["entry", new Date(`2026-01-01T${checkpoint}Z`)]]))
      let now = new Date("2026-01-01T00:01:00.000Z")
      const listener = create(state, policy, () => now)
      const fired: string[] = []
      const notify = async (_content: string, meta?: Record<string, string>) => {
        fired.push(meta!.fired_at!)
      }
      try {
        await listener.tick(notify)
        await listener.tick(notify)
        expect(fired).toEqual(["2026-01-01T00:01:00.000Z"])
        expect(state.load().get("entry")?.toISOString()).toBe(fired[0])
        now = new Date("2026-01-01T00:02:00.000Z")
        await listener.tick(notify)
        expect(fired).toEqual(["2026-01-01T00:01:00.000Z", "2026-01-01T00:02:00.000Z"])
      } finally {
        await listener.stop()
      }
    })
  }
}

test("all catch-up produces minute boundaries after a checkpoint containing seconds", async () => {
  const state = new FunnelScheduleStateStore()
  state.save(new Map([["entry", new Date("2026-01-01T00:00:30.123Z")]]))
  const now = () => new Date("2026-01-01T00:03:00.000Z")
  const listener = create(state, "all", now)
  const fired: string[] = []
  const notify = async (_content: string, meta?: Record<string, string>) => {
    fired.push(meta!.fired_at!)
  }
  try {
    await listener.tick(notify)
    expect(fired).toEqual([
      "2026-01-01T00:01:00.000Z",
      "2026-01-01T00:02:00.000Z",
      "2026-01-01T00:03:00.000Z",
    ])
    expect(state.load().get("entry")?.toISOString()).toBe(fired.at(-1))
    const reloaded = create(state, "all", now)
    try {
      await reloaded.tick(notify)
      expect(fired).toHaveLength(3)
    } finally {
      await reloaded.stop()
    }
  } finally {
    await listener.stop()
  }
})

test("a cron entry can resume from a one-shot checkpoint with the same entry ID", async () => {
  const state = new FunnelScheduleStateStore()
  const now = () => new Date("2026-01-01T00:01:00.000Z")
  const once = new FunnelScheduleListener({
    config: {
      id: "source",
      name: "source",
      type: "schedule",
      entries: [
        {
          id: "entry",
          kind: "once",
          runAt: "2026-01-01T00:00:30.123Z",
          prompt: "one-shot",
          enabled: true,
          catchupPolicy: "latest",
        },
      ],
    },
    lastFiredStore: state,
    now,
  })
  try {
    const fired: string[] = []
    await once.tick(async (_content, meta) => {
      fired.push(meta!.fired_at!)
    })
    expect(fired).toEqual(["2026-01-01T00:00:30.123Z"])
    const cron = create(state, "all", now)
    try {
      await cron.tick(async (_content, meta) => {
        fired.push(meta!.fired_at!)
      })
      expect(fired).toEqual(["2026-01-01T00:00:30.123Z", "2026-01-01T00:01:00.000Z"])
    } finally {
      await cron.stop()
    }
  } finally {
    await once.stop()
  }
})
