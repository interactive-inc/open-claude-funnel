import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteEventLog } from "@/event-log/sqlite-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"
import { Funnel } from "@/funnel"
import { Database } from "bun:sqlite"
import { z } from "zod"

test("SQLite sequence advances even when retention removes every row", () => {
  const log = new SqliteEventLog<string>({ path: ":memory:", maxRows: 0 })
  try {
    expect(log.insert({ ts: 1, event: "first" })).toMatchObject({ seq: 1 })
    expect(log.query()).toEqual([])
    expect(log.insert({ ts: 2, event: "second" })).toMatchObject({ seq: 2 })
    expect(log.getMaxSeq()).toBe(2)
  } finally {
    log.close()
  }
})

test("clearing a SQLite log does not reuse a previously assigned sequence", () => {
  const log = new SqliteEventLog<string>({ path: ":memory:" })
  try {
    log.insert({ ts: 1, event: "first" })
    log.clear()
    expect(log.getMaxSeq()).toBe(1)
    expect(log.insert({ ts: 2, event: "second" })).toMatchObject({ seq: 2 })
  } finally {
    log.close()
  }
})

test("a recreated gateway continues durable offsets after all retained payloads are removed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "funnel-offset-"))
  const path = join(dir, "events.db")
  const first = new SqliteFunnelEventLog({ path, maxRows: 0 })
  first.record({ offset: 9, content: "pruned", channelId: null, connectorId: null, meta: null })
  first.close()
  const reopened = new SqliteFunnelEventLog({ path, maxRows: 0 })
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
    token: "",
    eventLog: reopened,
  })
  try {
    expect(reopened.loadSince(0)).toEqual([])
    expect(gateway.emit({ channel: "ops", content: "next" }).offset).toBe(10)
  } finally {
    await gateway.stop()
    reopened.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("sequence migration preserves existing rows and custom indexes", () => {
  const dir = mkdtempSync(join(tmpdir(), "funnel-sequence-migration-"))
  const path = join(dir, "events.db")
  const legacy = new Database(path)
  legacy.run(
    "CREATE TABLE logs (seq INTEGER PRIMARY KEY, ts INTEGER NOT NULL, type TEXT, event TEXT NOT NULL, channel_id TEXT)",
  )
  legacy.run("CREATE INDEX idx_logs_channel_id ON logs (channel_id)")
  legacy
    .query("INSERT INTO logs VALUES (?, ?, ?, ?, ?)")
    .run(42, 1, "message", '{"channel":"ops"}', "ops")
  legacy.run("PRAGMA user_version = 2")
  legacy.close()
  const log = new SqliteEventLog<{ channel: string }, ["channel_id"]>({
    path,
    indexes: ["channel_id"],
    extractIndexes: (event) => ({ channel_id: event.channel }),
  })
  try {
    expect(log.query({ where: { channel_id: "ops" } })).toMatchObject([
      { seq: 42, event: { channel: "ops" } },
    ])
    expect(log.insert({ ts: 2, event: { channel: "other" } })).toMatchObject({ seq: 43 })
    expect(log.getSchemaVersion()).toBe(3)
  } finally {
    log.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("failed batches roll back the payload and sequence together", () => {
  const log = new SqliteEventLog<unknown>({ path: ":memory:" })
  const cyclic: { self?: unknown } = {}
  cyclic.self = cyclic
  try {
    expect(
      log.insertMany([
        { ts: 1, event: "first" },
        { ts: 2, event: cyclic },
      ]),
    ).toBeInstanceOf(Error)
    expect(log.query()).toEqual([])
    expect(log.getMaxSeq()).toBe(0)
    expect(log.insert({ ts: 3, event: "retry" })).toMatchObject({ seq: 1 })
  } finally {
    log.close()
  }
})

test("explicit relay offsets advance the sequence without moving it backwards", () => {
  const log = new SqliteEventLog<string>({ path: ":memory:" })
  try {
    expect(log.write({ seq: 50, ts: 1, event: "relay" })).toBeUndefined()
    expect(log.write({ seq: 5, ts: 2, event: "older" })).toBeUndefined()
    expect(log.insert({ ts: 3, event: "local" })).toMatchObject({ seq: 51 })
    expect(log.write({ seq: 50, ts: 4, event: "duplicate" })).toBeInstanceOf(Error)
    expect(log.getMaxSeq()).toBe(51)
  } finally {
    log.close()
  }
})

test("invalid offsets cannot poison the durable sequence", () => {
  const log = new SqliteEventLog<string>({ path: ":memory:" })
  try {
    for (const seq of [-1, 0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(log.write({ seq, ts: 1, event: "invalid" })).toBeInstanceOf(Error)
    expect(log.getMaxSeq()).toBe(0)
    expect(log.query()).toEqual([])
    log.write({ seq: Number.MAX_SAFE_INTEGER, ts: 2, event: "last" })
    expect(log.insert({ ts: 3, event: "overflow" })).toBeInstanceOf(Error)
    expect(log.getMaxSeq()).toBe(Number.MAX_SAFE_INTEGER)
  } finally {
    log.close()
  }
})

test("two processes share a monotonic sequence even with zero retained rows", async () => {
  const dir = mkdtempSync(join(tmpdir(), "funnel-sequence-writers-"))
  const path = join(dir, "events.db")
  const script = join(dir, "writer.ts")
  const seed = new SqliteEventLog<string>({ path })
  seed.close()
  await Bun.write(
    script,
    `
    import { SqliteEventLog } from ${JSON.stringify(import.meta.resolve("@/event-log/sqlite-event-log"))}
    const log = new SqliteEventLog({ path: process.argv[2], maxRows: 0 })
    const sequences = []
    try {
      for (let index = 0; index < 20; index++) {
        const record = log.insert({ ts: index, event: "event" })
        if (record instanceof Error) throw record
        sequences.push(record.seq)
      }
      console.log(JSON.stringify(sequences))
    } finally { log.close() }
  `,
  )
  const writers = [
    Bun.spawn([process.execPath, script, path], { stdout: "pipe", stderr: "pipe" }),
    Bun.spawn([process.execPath, script, path], { stdout: "pipe", stderr: "pipe" }),
  ]
  try {
    const sequences: number[] = []
    for (const writer of writers) {
      const output = await new Response(writer.stdout).text()
      expect(await new Response(writer.stderr).text()).toBe("")
      expect(await writer.exited).toBe(0)
      sequences.push(...z.array(z.number()).parse(JSON.parse(output)))
    }
    expect(sequences.sort((left, right) => left - right)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    )
  } finally {
    for (const writer of writers) {
      writer.kill()
      await writer.exited
    }
    rmSync(dir, { recursive: true, force: true })
  }
})
