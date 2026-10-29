import { expect, spyOn, test } from "bun:test"
import { Database } from "bun:sqlite"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"

const runSql = Database.prototype.run

for (const property of ["then", "catch"] as const) {
  for (const behavior of ["hidden", "throwing"] as const) {
    test(`maintenance observer promises with ${behavior} ${property} cannot leak rejection or undo clear`, async () => {
      const deferred = Promise.withResolvers<void>()
      let reads = 0
      // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host maintenance observer's overridden promise method.
      Object.defineProperty(deferred.promise, property, {
        get() {
          reads++
          if (behavior === "throwing") throw new Error("method unavailable")
          return undefined
        },
      })
      const failure = new Error("vacuum unavailable")
      const reported: Error[] = []
      const log = new SqliteEventLog<string>({
        path: ":memory:",
        onMaintenanceError(error) {
          reported.push(error)
          return deferred.promise
        },
      })
      expect(log.insert({ ts: 0, event: "original" })).toMatchObject({ seq: 1 })
      const run = spyOn(Database.prototype, "run").mockImplementation(function (
        this: Database,
        sql,
        ...params
      ) {
        if (sql === "VACUUM") throw failure
        return runSql.call(this, sql, ...params)
      })
      try {
        expect(() => log.clear()).not.toThrow()
        expect(reported).toEqual([failure])
        deferred.reject(new Error("maintenance reporter rejected"))
        await Bun.sleep(0)
        expect(reads).toBe(0)
        expect(log.query()).toEqual([])
        expect(log.getMaxSeq()).toBe(1)
        expect(log.insert({ ts: 1, event: "later" })).toMatchObject({ seq: 2 })
        expect(log.query().map((row) => row.event)).toEqual(["later"])
      } finally {
        run.mockRestore()
        log.close()
      }
    })
  }
}
