/** Host-owned state boundary; values are last successful fire times by entry ID. */
export type ScheduleStateStore = { load(): Map<string, Date>; save(state: Map<string, Date>): void }

export class FunnelScheduleStateStore implements ScheduleStateStore {
  private state = new Map<string, Date>()
  load(): Map<string, Date> {
    return this.snapshot(this.state)
  }
  save(state: Map<string, Date>): void {
    this.state = this.snapshot(state)
  }

  private snapshot(state: ReadonlyMap<string, Date>): Map<string, Date> {
    return new Map(
      Array.from(state, (entry): [string, Date] => [entry[0], new Date(entry[1].getTime())]),
    )
  }
}
