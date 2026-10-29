import { snapshotScheduleState } from "@/engine/connectors/schedule-state-snapshot"

/** Host-owned state boundary; values are last successful fire times by entry ID. */
export type ScheduleStateStore = { load(): Map<string, Date>; save(state: Map<string, Date>): void }

export class FunnelScheduleStateStore implements ScheduleStateStore {
  private state = new Map<string, Date>()
  load(): Map<string, Date> {
    return snapshotScheduleState(this.state)
  }
  save(state: Map<string, Date>): void {
    this.state = snapshotScheduleState(state)
  }
}
