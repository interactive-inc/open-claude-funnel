import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { Funnel } from "@/funnel"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`an invalid restored offset ${offset} cannot poison the broadcast sequence`, () => {
    const broadcaster = new FunnelBroadcaster()
    expect(() => broadcaster.seedLatestOffset(offset)).toThrow("non-negative safe integer")
    expect(broadcaster.broadcast("first").offset).toBe(1)
  })
}

test("offset exhaustion cannot deliver duplicate or unsafe offsets", () => {
  const persisted: number[] = []
  const delivered: number[] = []
  const broadcaster = new FunnelBroadcaster({
    record: (event) => {
      persisted.push(event.offset)
    },
  })
  broadcaster.subscribe((event) => {
    delivered.push(event.offset)
  })
  broadcaster.seedLatestOffset(Number.MAX_SAFE_INTEGER - 1)
  expect(broadcaster.broadcast("last valid").offset).toBe(Number.MAX_SAFE_INTEGER)
  for (let attempt = 0; attempt < 2; attempt++)
    expect(() => broadcaster.broadcast("exhausted")).toThrow("offset range exhausted")
  expect(persisted).toEqual([Number.MAX_SAFE_INTEGER])
  expect(delivered).toEqual(persisted)
  expect(broadcaster.getMetrics().latestOffset).toBe(Number.MAX_SAFE_INTEGER)
})

test("a gateway rejects a corrupt durable sequence before accepting events", () => {
  const dir = mkdtempSync(join(tmpdir(), "funnel-offset-invalid-"))
  const path = join(dir, "events.db")
  new SqliteFunnelEventLog({ path }).close()
  const database = new Database(path)
  database.run("UPDATE log_sequence SET seq = 1.5 WHERE id = 1")
  database.close()
  const store = new SqliteFunnelEventLog({ path })
  try {
    expect(store.findMaxOffset()).toBe(1.5)
    expect(() => new Funnel().gatewayModule({ token: "", eventLog: store })).toThrow(
      "non-negative safe integer",
    )
  } finally {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("HTTP publication fails before persisting an offset beyond the supported range", async () => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
    token: "example-token",
  })
  gateway.getBroadcaster().seedLatestOffset(Number.MAX_SAFE_INTEGER - 1)
  const publish = () =>
    gateway.app.request("/channels/ops/publish", {
      method: "POST",
      headers: { authorization: "Bearer example-token", "content-type": "application/json" },
      body: JSON.stringify({ content: "host input" }),
    })
  try {
    const last = await publish()
    expect(last.status).toBe(200)
    expect(await last.json()).toEqual({ ok: true, offset: Number.MAX_SAFE_INTEGER })
    const exhausted = await publish()
    expect(exhausted.status).toBe(500)
    expect(await exhausted.json()).toEqual({ error: "event offset range exhausted" })
    expect(
      gateway
        .getEventLog()
        .loadSince(0)
        .map((event) => event.offset),
    ).toEqual([Number.MAX_SAFE_INTEGER])
  } finally {
    await gateway.stop()
  }
})
