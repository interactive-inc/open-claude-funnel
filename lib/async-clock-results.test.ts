import { expect, test } from "bun:test"
import { FunnelClock } from "@/engine/time/clock"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"

for (const path of ["millis", "iso", "broadcast", "diagnostics", "schedule"] as const) {
  for (const kind of ["resolved", "rejected", "hidden-then", "thenable"] as const) {
    test(`${path} rejects a ${kind} asynchronous clock before changing state and can recover`, async () => {
      let invalid = true
      const numeric = path === "broadcast" || path === "diagnostics"
      const bad = (): unknown => {
        if (kind === "thenable")
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied asynchronous clock.
            then(_resolve: unknown, reject: (error: unknown) => void) {
              reject(new Error("clock unavailable"))
            },
          }
        const value =
          kind === "resolved"
            ? Promise.resolve(numeric ? 0 : new Date(0))
            : Promise.reject(new Error("clock unavailable"))
        void value.catch(() => {})
        if (kind === "hidden-then") {
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise with a hidden method.
          Object.defineProperty(value, "then", { value: undefined })
        }
        return value
      }
      if (path === "millis" || path === "iso") {
        let reads = 0
        class Clock extends FunnelClock {
          now(): Date {
            reads++
            return invalid ? (bad() as never) : new Date(0)
          }
        }
        const clock = new Clock()
        const read = path === "millis" ? () => clock.millis() : () => clock.iso()
        expect(read).toThrow("clock now must be synchronous")
        invalid = false
        expect(read()).toBe(path === "millis" ? 0 : "1970-01-01T00:00:00.000Z")
        expect(reads).toBe(2)
      } else if (path === "broadcast") {
        const persisted: number[] = []
        const delivered: number[] = []
        const broadcaster = new FunnelBroadcaster({
          now: () => (invalid ? (bad() as never) : 0),
          record: (event) => {
            persisted.push(event.offset)
          },
        })
        broadcaster.subscribe((event) => {
          delivered.push(event.offset)
        })
        expect(() => broadcaster.broadcast("input")).toThrow("time must be synchronous")
        expect(persisted).toEqual([])
        expect(delivered).toEqual([])
        invalid = false
        expect(broadcaster.broadcast("recovered").offset).toBe(1)
        expect(persisted).toEqual([1])
        expect(delivered).toEqual([1])
      } else if (path === "diagnostics") {
        const log = new MemoryConnectorDiagnosticLog(() => (invalid ? (bad() as never) : 0))
        const record = () =>
          log.recordConnection({
            type: "example",
            connectorId: "source",
            channelId: "ops",
            status: "connected",
            detail: "input",
          })
        expect(record).toThrow("time must be synchronous")
        expect(log.queryConnection({})).toEqual([])
        invalid = false
        record()
        expect(log.queryConnection({})).toMatchObject([{ seq: 1, ts: 0 }])
      } else {
        const state = new FunnelScheduleStateStore()
        const listener = new FunnelScheduleListener({
          config: {
            id: "source",
            name: "source",
            type: "schedule",
            entries: [
              {
                id: "entry",
                kind: "once",
                runAt: "1970-01-01T00:00:00.000Z",
                prompt: "input",
                enabled: true,
                catchupPolicy: "latest",
              },
            ],
          },
          lastFiredStore: state,
          now: () => (invalid ? (bad() as never) : new Date(0)),
        })
        const delivered: string[] = []
        const notify = async (content: string) => {
          delivered.push(content)
        }
        try {
          await expect(listener.tick(notify)).rejects.toThrow("clock now must be synchronous")
          await expect(listener.start(notify)).rejects.toThrow("clock now must be synchronous")
          expect(listener.isAlive()).toBe(false)
          expect(delivered).toEqual([])
          expect([...state.load()]).toEqual([])
          invalid = false
          await listener.start(notify)
          expect(delivered).toEqual(["input"])
          expect(state.load().get("entry")?.getTime()).toBe(0)
        } finally {
          await listener.stop()
        }
      }
      await Bun.sleep(0)
    })
  }
}
