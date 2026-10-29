import { expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import type { ScheduleEntry } from "@/engine/connectors/schedule-connector-schema"

for (const stage of ["load", "save"] as const) {
  for (const kind of ["promise", "thenable"] as const) {
    test(`schedule rejects and observes ${kind} ${stage} results before reporting a successful checkpoint`, async () => {
      const deferred = Promise.withResolvers<Map<string, Date>>()
      const value =
        kind === "promise"
          ? deferred.promise
          : {
              // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied state store thenable.
              then(resolve: (state: Map<string, Date>) => void, reject: (error: unknown) => void) {
                return deferred.promise.then(resolve, reject)
              },
            }
      let delivered = 0
      let fired = 0
      const diagnostics = new MemoryConnectorDiagnosticLog()
      const listener = new FunnelScheduleListener({
        config: {
          id: "source",
          type: "schedule",
          name: "source",
          entries: [
            {
              id: "entry",
              kind: "once",
              runAt: "2026-01-01T00:00:00.000Z",
              prompt: "input",
              enabled: true,
              catchupPolicy: "latest",
            },
          ],
        },
        lastFiredStore: {
          load: () => (stage === "load" ? (value as unknown as Map<string, Date>) : new Map()),
          save: () => (stage === "save" ? value : undefined),
        },
        diagnosticLog: diagnostics,
        onFired: () => {
          fired++
        },
        now: () => new Date("2026-01-01T00:00:00.000Z"),
      })
      await expect(
        listener.tick(async () => {
          delivered++
        }),
      ).rejects.toThrow(`schedule state ${stage} must be synchronous`)
      deferred.reject(new Error(`original ${stage} rejection`))
      await Bun.sleep(0)
      expect(delivered).toBe(stage === "load" ? 0 : 1)
      expect(fired).toBe(0)
      expect(diagnostics.queryConnection({ status: "error" }).map((row) => row.detail)).toContain(
        `tick: original ${stage} rejection`,
      )
    })
  }
}

for (const phase of ["prune", "skip", "watermark"] as const) {
  test(`schedule ${phase} rejects asynchronous checkpoint saves`, async () => {
    const entries: ScheduleEntry[] =
      phase === "prune"
        ? []
        : [
            {
              id: "entry",
              prompt: "input",
              enabled: true,
              catchupPolicy: phase === "skip" ? "skip" : "latest",
              ...(phase === "skip"
                ? { kind: "once", runAt: "2025-12-31T23:59:00.000Z" }
                : { kind: "cron", cron: "5 * * * *", createdAt: "2026-01-01T00:00:00.000Z" }),
            },
          ]
    let delivered = 0
    const listener = new FunnelScheduleListener({
      config: { id: "source", type: "schedule", name: "source", entries },
      now: () => new Date("2026-01-01T00:00:00.000Z"),
      lastFiredStore: {
        load: () => (phase === "prune" ? new Map([["removed", new Date(0)]]) : new Map()),
        save: async () => {},
      },
    })
    await expect(
      listener.tick(async () => {
        delivered++
      }),
    ).rejects.toThrow("schedule state save must be synchronous")
    expect(delivered).toBe(0)
  })
}
