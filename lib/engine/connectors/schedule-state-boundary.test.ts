import { expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import type { ScheduleEntry } from "@/engine/connectors/schedule-connector-schema"
import { runInNewContext } from "node:vm"

const once = (id: string): ScheduleEntry => ({
  id,
  kind: "once",
  runAt: "2026-01-01T00:00:00.000Z",
  prompt: id,
  enabled: true,
  catchupPolicy: "latest",
})
const now = () => new Date("2026-01-01T00:00:00.000Z")

test("checkpoint snapshots accept maps from another realm and detach their dates", () => {
  const state: Map<string, Date> = runInNewContext('new Map([["entry", new Date(0)]])')
  const store = new FunnelScheduleStateStore()
  store.save(state)
  state.get("entry")!.setTime(60_000)
  expect([...store.load()]).toEqual([["entry", new Date(0)]])
})

for (const [name, value] of [
  ["plain object", {}],
  ["array-like object", { length: 0 }],
  ["JSON dictionary", { entry: "2026-01-01T00:00:00.000Z" }],
  ["number", 0],
  ["boolean", false],
  ["empty string", ""],
] as const) {
  test(`${name} cannot erase the default checkpoint store`, () => {
    const store = new FunnelScheduleStateStore()
    store.save(new Map([["entry", now()]]))
    expect(() => store.save(value as unknown as Map<string, Date>)).toThrow(
      "schedule state must be an iterable map",
    )
    expect([...store.load()]).toEqual([["entry", now()]])
  })

  test(`${name} checkpoint loads fail before notification or overwrite`, async () => {
    let state = value as unknown as Map<string, Date>
    let delivered = 0
    let saves = 0
    const listener = new FunnelScheduleListener({
      config: { id: "source", name: "source", type: "schedule", entries: [once("entry")] },
      now,
      lastFiredStore: {
        load: () => state,
        save() {
          saves++
        },
      },
    })
    const notify = async () => {
      delivered++
    }
    await expect(listener.tick(notify)).rejects.toThrow("schedule state must be an iterable map")
    expect(delivered).toBe(0)
    expect(saves).toBe(0)
    state = new Map([["entry", now()]])
    await listener.tick(notify)
    expect(delivered).toBe(0)
    expect(saves).toBe(0)
  })
}

test("invalid checkpoint saves cannot replace the default store's last valid snapshot", () => {
  const store = new FunnelScheduleStateStore()
  store.save(new Map([["original", now()]]))
  expect(() =>
    store.save(
      new Map([
        ["valid", now()],
        ["invalid", new Date(NaN)],
      ]),
    ),
  ).toThrow("schedule checkpoint must be a valid timestamp")
  expect([...store.load()]).toEqual([["original", now()]])
})

for (const kind of ["once", "cron"] as const) {
  test(`an invalid persisted ${kind} checkpoint is rejected before notification or pruning`, async () => {
    let persisted = new Map([
      ["entry", new Date(NaN)],
      ["removed", now()],
    ])
    let saves = 0
    const entry: ScheduleEntry =
      kind === "once"
        ? once("entry")
        : {
            id: "entry",
            kind,
            cron: "* * * * *",
            prompt: "entry",
            enabled: true,
            catchupPolicy: "latest",
          }
    const listener = new FunnelScheduleListener({
      config: { id: "source", name: "source", type: "schedule", entries: [entry] },
      now,
      lastFiredStore: {
        load: () => persisted,
        save(next) {
          saves++
          persisted = next
        },
      },
    })
    const delivered: string[] = []
    const notify = async (content: string) => {
      delivered.push(content)
    }
    try {
      await expect(listener.tick(notify)).rejects.toThrow(
        "schedule checkpoint must be a valid timestamp",
      )
      expect(delivered).toEqual([])
      expect(saves).toBe(0)
      expect(persisted.has("removed")).toBe(true)
      persisted = new Map()
      await listener.tick(notify)
      expect(delivered).toEqual(["entry"])
    } finally {
      await listener.stop()
    }
  })
}

test("failed pruning cannot mutate a map owned by the host store", async () => {
  const persisted = new Map([["removed", now()]])
  const listener = new FunnelScheduleListener({
    config: { id: "source", name: "source", type: "schedule", entries: [] },
    now,
    lastFiredStore: {
      load: () => persisted,
      save() {
        throw new Error("pruning failed")
      },
    },
  })
  try {
    await expect(listener.tick(async () => {})).rejects.toThrow("pruning failed")
    expect([...persisted]).toEqual([["removed", now()]])
  } finally {
    await listener.stop()
  }
})

test("a failed later save cannot update a host-retained checkpoint map without a successful save", async () => {
  let persisted = new Map<string, Date>()
  let saves = 0
  const listener = new FunnelScheduleListener({
    config: { id: "source", name: "source", type: "schedule", entries: [once("a"), once("b")] },
    now,
    lastFiredStore: {
      load: () => persisted,
      save(next) {
        if (++saves === 2) throw new Error("checkpoint failed")
        persisted = next
      },
    },
  })
  const delivered: string[] = []
  const notify = async (content: string) => {
    delivered.push(content)
  }
  try {
    await expect(listener.tick(notify)).rejects.toThrow("checkpoint failed")
    expect([...persisted.keys()]).toEqual(["a"])
    await listener.tick(notify)
    expect(delivered).toEqual(["a", "b", "b"])
    expect([...persisted.keys()]).toEqual(["a", "b"])
  } finally {
    await listener.stop()
  }
})
