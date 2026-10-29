import { Database } from "bun:sqlite"
import { expect, spyOn, test } from "bun:test"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { SqliteExclusiveClaims } from "@/gateway/event-log/sqlite-exclusive-claims"
import { Funnel } from "@/funnel"

for (const method of ["insert", "batch", "write"] as const) {
  test(`${method} rolls back payload, sequence and retention when the retention clock fails`, () => {
    let fail = false
    let now = 100
    const log = new SqliteEventLog<string>({
      path: ":memory:",
      maxRows: method === "batch" ? 2 : 1,
      maxAgeMs: 50,
      now() {
        if (fail) throw new Error("retention clock failed")
        return now
      },
    })
    const write = () =>
      method === "insert"
        ? log.insert({ ts: 200, event: "new" })
        : method === "batch"
          ? log.insertMany([
              { ts: 200, event: "new" },
              { ts: 201, event: "next" },
            ])
          : log.write({ seq: 2, ts: 200, event: "new" })
    try {
      expect(log.insert({ ts: 100, event: "original" })).toMatchObject({ seq: 1 })
      now = 200
      fail = true
      expect(write()).toBeInstanceOf(Error)
      expect(log.query()).toEqual([{ seq: 1, ts: 100, event: "original" }])
      expect(log.getMaxSeq()).toBe(1)
      fail = false
      expect(write()).not.toBeInstanceOf(Error)
      expect(log.query()[0]).toMatchObject({ seq: 2, event: "new" })
    } finally {
      log.close()
    }
  })
}

test("a failed vacuum does not report a committed insert as failed", () => {
  const failures: Error[] = []
  const log = new SqliteEventLog<string>({
    path: ":memory:",
    maxBytes: 1,
    targetBytes: 0,
    onMaintenanceError(error) {
      failures.push(error)
    },
  })
  const original = Database.prototype.run
  const run = spyOn(Database.prototype, "run").mockImplementation(function (
    this: Database,
    sql,
    ...params
  ) {
    if (sql === "VACUUM") throw new Error("vacuum unavailable")
    return original.call(this, sql, ...params)
  })
  try {
    for (let index = 1; index <= 500; index++) {
      expect(log.insert({ ts: index, event: "entry" })).toMatchObject({ seq: index })
    }
    expect(log.getMaxSeq()).toBe(500)
    expect(failures.map((error) => error.message)).toEqual(["vacuum unavailable"])
    expect(log.insert({ ts: 501, event: "later" })).toMatchObject({ seq: 501 })
  } finally {
    run.mockRestore()
    log.close()
  }
})

test("failed exclusive-claim pruning does not turn a committed record into a failed write", () => {
  const errors: { op?: unknown }[] = []
  const log = new SqliteFunnelEventLog({
    path: ":memory:",
    maxRows: 1,
    onError(_error, context) {
      errors.push({ op: context?.op })
    },
  })
  const record = {
    channelId: "ops",
    connectorId: "source",
    meta: null,
    content: "original",
    offset: 1,
  }
  log.record(record)
  const prune = spyOn(SqliteExclusiveClaims.prototype, "pruneBefore").mockImplementation(() => {
    throw new Error("claim pruning unavailable")
  })
  try {
    expect(() => log.record({ ...record, offset: 2, content: "new" })).not.toThrow()
    expect(log.loadSince(0).map((event) => event.content)).toEqual(["new"])
    expect(log.findMaxOffset()).toBe(2)
    expect(errors).toEqual([{ op: "prune-claims" }])
  } finally {
    prune.mockRestore()
    log.close()
  }
})

test("a gateway cannot replay or deliver a record whose retention transaction failed", async () => {
  let calls = 0
  const store = new SqliteFunnelEventLog({
    path: ":memory:",
    maxAgeMs: 50,
    now() {
      if (++calls === 2) throw new Error("retention failed")
      return 100
    },
  })
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
    token: "",
    eventLog: store,
  })
  const seen: string[] = []
  gateway.getBroadcaster().subscribe((event) => {
    seen.push(event.content)
  })
  try {
    expect(() => gateway.emit({ channel: "ops", content: "failed" })).toThrow("retention failed")
    expect(seen).toEqual([])
    expect(store.loadSince(0)).toEqual([])
    expect(store.findMaxOffset()).toBe(0)
    expect(gateway.emit({ channel: "ops", content: "retry" }).offset).toBe(2)
    expect(seen).toEqual(["retry"])
    expect(store.loadSince(0).map((event) => event.content)).toEqual(["retry"])
  } finally {
    await gateway.stop()
    store.close()
  }
})

test("a gateway reports failed compaction while delivering every committed event", async () => {
  const failures: unknown[] = []
  const store = new SqliteFunnelEventLog({
    path: ":memory:",
    maxBytes: 1,
    targetBytes: 0,
    onError(_error, context) {
      failures.push(context?.op)
    },
  })
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
    token: "",
    eventLog: store,
  })
  let delivered = 0
  gateway.getBroadcaster().subscribe(() => {
    delivered++
  })
  const original = Database.prototype.run
  const run = spyOn(Database.prototype, "run").mockImplementation(function (
    this: Database,
    sql,
    ...params
  ) {
    if (sql === "VACUUM") throw new Error("vacuum unavailable")
    return original.call(this, sql, ...params)
  })
  try {
    for (let index = 1; index <= 500; index++)
      expect(gateway.emit({ channel: "ops", content: "entry" }).offset).toBe(index)
    expect(delivered).toBe(500)
    expect(store.findMaxOffset()).toBe(500)
    expect(failures).toEqual(["compact"])
  } finally {
    run.mockRestore()
    await gateway.stop()
    store.close()
  }
})
