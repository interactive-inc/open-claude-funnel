import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"

test("schedule state is isolated even when stable ids contain the key separator", async () => {
  const entry = { id: "once", kind: "once", runAt: "2026-01-01T00:00:00.000Z", prompt: "due" }
  const funnel = new Funnel({
    connectors: [scheduleConnector()],
    clock: new MemoryFunnelClock({ start: new Date(entry.runAt) }),
    store: new MemoryFunnelSettingsStore({
      channels: [
        {
          id: "a\0b",
          name: "first",
          delivery: "fanout",
          connectors: [{ id: "c", name: "timer", type: "schedule", entries: [entry] }],
        },
        {
          id: "a",
          name: "second",
          delivery: "fanout",
          connectors: [{ id: "b\0c", name: "timer", type: "schedule", entries: [entry] }],
        },
      ],
    }),
  })
  const fired: string[] = []
  for (const name of ["first", "second"]) {
    const listener = funnel.channels.createListener(name, "timer")!.listener
    try {
      await listener.start(async () => {
        fired.push(name)
      })
    } finally {
      await listener.stop()
    }
  }
  expect(fired).toEqual(["first", "second"])
})

test("saving schedule state detaches mutable Date values from the host", () => {
  const store = new FunnelScheduleStateStore()
  const firedAt = new Date("2026-01-01T00:00:00.000Z")
  store.save(new Map([["entry", firedAt]]))
  firedAt.setUTCFullYear(2099)
  expect(store.load().get("entry")?.toISOString()).toBe("2026-01-01T00:00:00.000Z")
})

test("loading schedule state cannot mutate its stored checkpoint", () => {
  const store = new FunnelScheduleStateStore()
  store.save(new Map([["entry", new Date("2026-01-01T00:00:00.000Z")]]))
  const snapshot = store.load()
  snapshot.get("entry")!.setUTCFullYear(2099)
  snapshot.delete("entry")
  expect(store.load().get("entry")?.toISOString()).toBe("2026-01-01T00:00:00.000Z")
})

test("an onFired observer cannot change the checkpoints saved by later entries", async () => {
  const clock = new MemoryFunnelClock({ start: new Date("2026-01-01T00:00:00.000Z") })
  const listener = new FunnelScheduleListener({
    config: {
      id: "timer",
      name: "timer",
      type: "schedule",
      entries: [
        {
          id: "a",
          kind: "cron",
          cron: "* * * * *",
          prompt: "a",
          enabled: true,
          catchupPolicy: "latest",
        },
        {
          id: "b",
          kind: "cron",
          cron: "* * * * *",
          prompt: "b",
          enabled: true,
          catchupPolicy: "latest",
        },
      ],
    },
    lastFiredStore: new FunnelScheduleStateStore(),
    now: () => clock.now(),
    onFired(_entry, firedAt) {
      firedAt.setUTCFullYear(2099)
    },
  })
  const fired: string[] = []
  await listener.tick(async (content) => {
    fired.push(content)
  })
  clock.advance(60_000)
  await listener.tick(async (content) => {
    fired.push(content)
  })
  expect(fired).toEqual(["a", "b", "a", "b"])
})

test("recreating a listener with the same stable ids keeps its one-shot checkpoint", async () => {
  const funnel = new Funnel({
    connectors: [scheduleConnector()],
    clock: new MemoryFunnelClock({ start: new Date("2026-01-01T00:00:00.000Z") }),
    channels: [
      {
        name: "ops",
        connectors: [
          {
            type: "schedule",
            name: "timer",
            entries: [
              { id: "once", kind: "once", runAt: "2026-01-01T00:00:00.000Z", prompt: "due" },
            ],
          },
        ],
      },
    ],
  })
  const fired: string[] = []
  for (const attempt of [1, 2]) {
    const listener = funnel.channels.createListener("ops", "timer")!.listener
    try {
      await listener.start(async () => {
        fired.push(String(attempt))
      })
    } finally {
      await listener.stop()
    }
  }
  expect(fired).toEqual(["1"])
})
