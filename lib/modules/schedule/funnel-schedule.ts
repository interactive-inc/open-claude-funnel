import type { FunnelScheduleStore } from "@/modules/connectors/funnel-schedule-store"
import type { ScheduleEntry } from "@/modules/connectors/schedule-connector-schema"

type Deps = {
  store: FunnelScheduleStore
}

export class FunnelSchedule {
  private readonly store: FunnelScheduleStore

  constructor(deps: Deps) {
    this.store = deps.store
    Object.freeze(this)
  }

  listEntries(connector: string): ScheduleEntry[] {
    const config = this.store.get(connector)

    if (!config) throw new Error(`connector "${connector}" not found`)

    return config.entries
  }

  addEntry(
    connector: string,
    entry: Omit<ScheduleEntry, "id"> & { id?: string },
  ): ScheduleEntry {
    return this.store.addEntry(connector, entry)
  }

  removeEntry(connector: string, id: string): void {
    this.store.removeEntry(connector, id)
  }
}
