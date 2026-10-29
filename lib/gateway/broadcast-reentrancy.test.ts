import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"

for (const phase of ["record", "clock", "channels"] as const) {
  test(`reentry from ${phase} cannot reorder native delivery or replay history`, async () => {
    const rejected: unknown[] = []
    const persisted: string[] = []
    let attempted = false
    const reenter = () => {
      if (attempted) return
      attempted = true
      try {
        broadcaster.broadcast("nested")
      } catch (error) {
        rejected.push(error)
      }
    }
    const broadcaster = new FunnelBroadcaster({
      record(event) {
        if (phase === "record") reenter()
        persisted.push(event.content)
      },
      now() {
        if (phase === "clock") reenter()
        return 1
      },
      channels() {
        if (phase === "channels") reenter()
        return []
      },
    })
    const events = broadcaster.events({ channel: "ops", connectors: [] })
    try {
      expect(broadcaster.broadcast("outer").offset).toBe(1)
      expect((await events.next()).value.content).toBe("outer")
      expect(rejected).toHaveLength(1)
      expect(rejected[0]).toMatchObject({
        message: "cannot broadcast during event persistence or delivery",
      })
      expect(broadcaster.broadcast("after").offset).toBe(2)
      expect((await events.next()).value.content).toBe("after")
      expect(persisted).toEqual(["outer", "after"])
      expect(
        broadcaster
          .replaySince(0, { channel: "ops", connectors: [] })
          .map((event) => event.content),
      ).toEqual(["outer", "after"])
    } finally {
      await events.return()
    }
  })
}

test("a failed broadcast clock is detected before persistence or offset allocation", () => {
  const persisted: string[] = []
  let fail = true
  const broadcaster = new FunnelBroadcaster({
    record(event) {
      persisted.push(event.content)
    },
    now() {
      if (fail) throw new Error("clock unavailable")
      return 1
    },
  })
  expect(() => broadcaster.broadcast("failed")).toThrow("clock unavailable")
  expect(persisted).toEqual([])
  expect(broadcaster.getMetrics()).toMatchObject({ eventsBroadcast: 0, latestOffset: 0 })
  fail = false
  expect(broadcaster.broadcast("retry").offset).toBe(1)
  expect(persisted).toEqual(["retry"])
})

test("an uncaught persistence reentry rejects the event and releases the broadcast guard", () => {
  const persisted: string[] = []
  const broadcaster = new FunnelBroadcaster({
    record(event) {
      if (event.content === "outer") broadcaster.broadcast("nested")
      persisted.push(event.content)
    },
  })
  expect(() => broadcaster.broadcast("outer")).toThrow(
    "cannot broadcast during event persistence or delivery",
  )
  expect(persisted).toEqual([])
  expect(broadcaster.replaySince(0, { channel: "ops", connectors: [] })).toEqual([])
  expect(broadcaster.broadcast("retry").offset).toBe(2)
  expect(persisted).toEqual(["retry"])
})

test("onEvent observers may publish derived input after the original input is delivered", async () => {
  const persisted: string[] = []
  const broadcaster = new FunnelBroadcaster({
    record: (event) => {
      persisted.push(event.content)
    },
  })
  const events = broadcaster.events({ channel: "ops", connectors: [] })
  broadcaster.subscribe((event) => {
    if (event.content === "outer") broadcaster.broadcast("derived")
  })
  try {
    expect(broadcaster.broadcast("outer").offset).toBe(1)
    expect((await events.next()).value.content).toBe("outer")
    expect((await events.next()).value.content).toBe("derived")
    expect(persisted).toEqual(["outer", "derived"])
  } finally {
    await events.return()
  }
})
