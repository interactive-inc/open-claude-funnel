import { expect, spyOn, test } from "bun:test"
import { Database } from "bun:sqlite"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { SqliteExclusiveClaims } from "@/gateway/event-log/sqlite-exclusive-claims"

for (const operation of ["insert", "batch", "write"] as const) {
  test(`SQLite ${operation} returns an error and rolls back an unprintable retention failure`, () => {
    let fail = false
    const log = new SqliteEventLog<string>({
      path: ":memory:",
      maxAgeMs: 100,
      now: () => {
        if (fail) throw Object.create(null)
        return 0
      },
    })
    try {
      expect(log.insert({ ts: 0, event: "original" })).toMatchObject({ seq: 1 })
      fail = true
      const input = { ts: 0, event: "new" }
      const result =
        operation === "insert"
          ? log.insert(input)
          : operation === "batch"
            ? log.insertMany([input])
            : log.write({ ...input, seq: 2 })
      expect(result).toBeInstanceOf(Error)
      expect((result as Error).message).toBe("Unprintable thrown value")
      expect(log.query()).toEqual([{ seq: 1, ts: 0, event: "original" }])
      expect(log.getMaxSeq()).toBe(1)
    } finally {
      log.close()
    }
  })
}

test("an unprintable vacuum failure cannot relabel a committed insert", () => {
  const failures: Error[] = []
  const log = new SqliteEventLog<string>({
    path: ":memory:",
    maxBytes: 1,
    targetBytes: 0,
    onMaintenanceError: (error) => {
      failures.push(error)
    },
  })
  const original = Database.prototype.run
  const run = spyOn(Database.prototype, "run").mockImplementation(function (
    this: Database,
    sql,
    ...params
  ) {
    if (sql === "VACUUM") throw Object.create(null)
    return original.call(this, sql, ...params)
  })
  try {
    for (let seq = 1; seq <= 500; seq++)
      expect(log.insert({ ts: 0, event: "input" })).toMatchObject({ seq })
    expect(log.getMaxSeq()).toBe(500)
    expect(failures.map((error) => error.message)).toEqual(["Unprintable thrown value"])
  } finally {
    run.mockRestore()
    log.close()
  }
})

test("unprintable claim cleanup failures remain maintenance notifications after persistence", () => {
  const reports: string[] = []
  const log = new SqliteFunnelEventLog({
    path: ":memory:",
    maxRows: 1,
    onError(error, context) {
      reports.push(`${context?.op}:${error.message}`)
    },
  })
  const prune = spyOn(SqliteExclusiveClaims.prototype, "pruneBefore").mockImplementation(() => {
    throw Object.create(null)
  })
  try {
    expect(() =>
      log.record({ content: "input", offset: 1, channelId: null, connectorId: null, meta: null }),
    ).not.toThrow()
    expect(log.loadSince(0).map((event) => event.offset)).toEqual([1])
    expect(reports).toEqual(["prune-claims:Unprintable thrown value"])
  } finally {
    prune.mockRestore()
    log.close()
  }
})
