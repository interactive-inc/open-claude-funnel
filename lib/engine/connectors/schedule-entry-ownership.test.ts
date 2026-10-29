import { expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import type { ScheduleEntry } from "@/engine/connectors/schedule-connector-schema"

const once = (): ScheduleEntry => ({
  id: "entry",
  kind: "once",
  runAt: "2026-01-01T00:00:00.000Z",
  prompt: "original",
  enabled: true,
  catchupPolicy: "latest",
})

test("editing an onFired entry cannot rewrite the identity or payload of later catch-up fires", async () => {
  const state = new FunnelScheduleStateStore()
  const delivered: { content: string; id: string | undefined }[] = []
  const listener = new FunnelScheduleListener({
    config: {
      id: "source",
      name: "source",
      type: "schedule",
      entries: [
        {
          id: "entry",
          kind: "cron",
          cron: "* * * * *",
          prompt: "original",
          enabled: true,
          catchupPolicy: "all",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    lastFiredStore: state,
    now: () => new Date("2026-01-01T00:02:00.000Z"),
    onFired(entry) {
      entry.id = "edited"
      entry.prompt = "edited"
      entry.enabled = false
    },
  })
  try {
    await listener.tick(async (content, meta) => {
      delivered.push({ content, id: meta?.schedule_id })
    })
    expect(delivered).toEqual(
      Array.from({ length: 3 }, () => ({ content: "original", id: "entry" })),
    )
    expect([...state.load().keys()]).toEqual(["entry"])
    expect(state.load().get("entry")?.toISOString()).toBe("2026-01-01T00:02:00.000Z")
  } finally {
    await listener.stop()
  }
})

test("editing an onFired one-shot entry cannot bypass its successful checkpoint", async () => {
  const state = new FunnelScheduleStateStore()
  const listener = new FunnelScheduleListener({
    config: { id: "source", name: "source", type: "schedule", entries: [once()] },
    lastFiredStore: state,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
    onFired(entry) {
      entry.id = "edited"
    },
  })
  const delivered: string[] = []
  try {
    const notify = async (content: string) => {
      delivered.push(content)
    }
    await listener.tick(notify)
    await listener.tick(notify)
    expect(delivered).toEqual(["original"])
    expect([...state.load().keys()]).toEqual(["entry"])
  } finally {
    await listener.stop()
  }
})

test("host config mutations during notification cannot move its checkpoint to a different entry", async () => {
  const entry = once()
  const config = { id: "source", name: "source", type: "schedule" as const, entries: [entry] }
  const state = new FunnelScheduleStateStore()
  const listener = new FunnelScheduleListener({
    config,
    lastFiredStore: state,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  })
  const delivered: { content: string; id: string | undefined }[] = []
  try {
    await listener.tick(async (content, meta) => {
      delivered.push({ content, id: meta?.schedule_id })
      entry.id = "edited"
      config.entries.push({ ...once(), id: "added" })
    })
    expect(delivered).toEqual([{ content: "original", id: "entry" }])
    expect([...state.load().keys()]).toEqual(["entry"])
  } finally {
    await listener.stop()
  }
})

test("snapshotting preserves typed config and entry fields defined by prototype getters", async () => {
  class Entry {
    get id() {
      return "entry"
    }
    kind = "once" as const
    runAt = "2026-01-01T00:00:00.000Z"
    prompt = "original"
    enabled = true
    catchupPolicy = "latest" as const
  }
  class Config {
    get id() {
      return "source"
    }
    name = "source"
    type = "schedule" as const
    get entries() {
      return [new Entry()]
    }
  }
  const state = new FunnelScheduleStateStore()
  const listener = new FunnelScheduleListener({
    config: new Config(),
    lastFiredStore: state,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  })
  const delivered: { content: string; id: string | undefined }[] = []
  try {
    await listener.tick(async (content, meta) => {
      delivered.push({ content, id: meta?.schedule_id })
    })
    expect(delivered).toEqual([{ content: "original", id: "entry" }])
    expect([...state.load().keys()]).toEqual(["entry"])
  } finally {
    await listener.stop()
  }
})
