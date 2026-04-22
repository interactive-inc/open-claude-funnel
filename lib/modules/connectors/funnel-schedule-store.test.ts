import { describe, expect, test } from "bun:test"
import { FunnelScheduleStore } from "@/modules/connectors/funnel-schedule-store"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"

const makeStore = () => {
  const fs = new MemoryFunnelFileSystem()
  return { fs, store: new FunnelScheduleStore({ fs, dir: "/fake" }) }
}

describe("FunnelScheduleStore", () => {
  test("add creates an empty connector", () => {
    const { store } = makeStore()
    store.add({ type: "schedule", name: "cron-a", entries: [] })

    const config = store.get("cron-a")
    expect(config?.type).toBe("schedule")
    expect(config?.entries).toEqual([])
  })

  test("adding a duplicate fails", () => {
    const { store } = makeStore()
    store.add({ type: "schedule", name: "cron-a", entries: [] })
    expect(() => store.add({ type: "schedule", name: "cron-a", entries: [] })).toThrow(
      /already exists/,
    )
  })

  test("addEntry appends a JSONL line", () => {
    const { store } = makeStore()
    store.add({ type: "schedule", name: "cron-a", entries: [] })
    const entry = store.addEntry("cron-a", { cron: "* * * * *", prompt: "hi", enabled: true })

    expect(entry.id).toBeTruthy()
    expect(store.get("cron-a")?.entries).toEqual([entry])
  })

  test("removeEntry removes the line", () => {
    const { store } = makeStore()
    store.add({ type: "schedule", name: "cron-a", entries: [] })
    const a = store.addEntry("cron-a", { cron: "* * * * *", prompt: "a", enabled: true })
    const b = store.addEntry("cron-a", { cron: "*/5 * * * *", prompt: "b", enabled: true })

    store.removeEntry("cron-a", a.id)

    const entries = store.get("cron-a")?.entries ?? []
    expect(entries).toHaveLength(1)
    expect(entries[0]?.id).toBe(b.id)
  })

  test("removeEntry on missing id throws", () => {
    const { store } = makeStore()
    store.add({ type: "schedule", name: "cron-a", entries: [] })
    expect(() => store.removeEntry("cron-a", "nope")).toThrow(/not found/)
  })

  test("list scans all .jsonl files", () => {
    const { store } = makeStore()
    store.add({ type: "schedule", name: "cron-a", entries: [] })
    store.add({ type: "schedule", name: "cron-b", entries: [] })

    const names = store.list().map((c) => c.name).sort()
    expect(names).toEqual(["cron-a", "cron-b"])
  })

  test("rename moves the file", () => {
    const { store } = makeStore()
    store.add({ type: "schedule", name: "cron-a", entries: [] })
    store.addEntry("cron-a", { cron: "* * * * *", prompt: "hi", enabled: true })

    store.rename("cron-a", "cron-b")

    expect(store.get("cron-a")).toBeNull()
    expect(store.get("cron-b")?.entries).toHaveLength(1)
  })
})
