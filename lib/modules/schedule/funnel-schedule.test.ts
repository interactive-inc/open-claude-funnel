import { describe, expect, test } from "bun:test"
import { FunnelScheduleStore } from "@/modules/connectors/funnel-schedule-store"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"
import { FunnelSchedule } from "@/modules/schedule/funnel-schedule"

const setup = () => {
  const fs = new MemoryFunnelFileSystem()
  const store = new FunnelScheduleStore({ fs, dir: "/fake" })
  const service = new FunnelSchedule({ store })
  return { fs, store, service }
}

describe("FunnelSchedule", () => {
  test("addEntry / listEntries / removeEntry round trip", () => {
    const { store, service } = setup()
    store.add({ type: "schedule", name: "cron-a", entries: [] })

    const entry = service.addEntry("cron-a", {
      cron: "*/5 * * * *",
      prompt: "hi",
      enabled: true,
    })
    expect(service.listEntries("cron-a")).toEqual([entry])

    service.removeEntry("cron-a", entry.id)
    expect(service.listEntries("cron-a")).toEqual([])
  })

  test("listEntries on missing connector throws", () => {
    const { service } = setup()
    expect(() => service.listEntries("missing")).toThrow(/not found/)
  })
})
