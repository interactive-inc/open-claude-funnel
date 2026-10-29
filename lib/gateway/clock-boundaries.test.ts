import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { FunnelBroadcaster } from "@/gateway/broadcaster"

test("the first broadcast at epoch zero has an explicit last-broadcast timestamp", () => {
  const broadcaster = new FunnelBroadcaster({ now: () => 0 })
  expect(broadcaster.getMetrics().lastBroadcastAt).toBeNull()
  broadcaster.broadcast("event")
  expect(broadcaster.getMetrics().lastBroadcastAt).toBe("1970-01-01T00:00:00.000Z")
})

test("status and debug measure uptime when a gateway starts at epoch zero", async () => {
  const clock = new MemoryFunnelClock()
  const gateway = new Funnel({ clock }).gatewayModule({ token: "example-token" })
  try {
    await gateway.start()
    clock.advance(5000)
    for (const path of ["/status", "/debug"]) {
      const response = await gateway.app.request(path, {
        headers: { authorization: "Bearer example-token" },
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({ uptimeMs: 5000 })
    }
  } finally {
    await gateway.stop()
  }
})

test("memory clock construction detaches the caller's mutable Date", () => {
  const start = new Date(0)
  const clock = new MemoryFunnelClock({ start })
  start.setTime(99_000)
  expect(clock.millis()).toBe(0)
})

test("setting the memory clock detaches the caller's mutable Date", () => {
  const clock = new MemoryFunnelClock()
  const date = new Date(1234)
  clock.set(date)
  date.setTime(99_000)
  expect(clock.millis()).toBe(1234)
  clock.now().setTime(0)
  expect(clock.millis()).toBe(1234)
})

for (const now of [NaN, Infinity, 8.64e15 + 1]) {
  test(`invalid broadcast time ${now} fails before the input is persisted`, () => {
    let recorded = 0
    const broadcaster = new FunnelBroadcaster({
      now: () => now,
      record: () => {
        recorded++
      },
    })
    expect(() => broadcaster.broadcast("event")).toThrow("time must be a valid timestamp")
    expect(recorded).toBe(0)
    expect(broadcaster.getMetrics()).toMatchObject({
      eventsBroadcast: 0,
      latestOffset: 0,
      lastBroadcastAt: null,
    })
  })
}

test("an invalid injected clock rejects gateway startup and can be corrected for retry", async () => {
  const clock = new MemoryFunnelClock({ start: new Date(NaN) })
  const gateway = new Funnel({ clock }).gatewayModule({ token: "" })
  try {
    await expect(gateway.start()).rejects.toThrow("time must be a valid timestamp")
    clock.set(new Date(0))
    await gateway.start()
    clock.advance(5000)
    const response = await gateway.app.request("/status")
    expect(await response.json()).toMatchObject({ uptimeMs: 5000 })
  } finally {
    await gateway.stop()
  }
})
