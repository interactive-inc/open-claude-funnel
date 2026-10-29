import { getEventListeners } from "node:events"
import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"

for (const close of ["return", "overflow", "shutdown"] as const) {
  test(`${close} removes the original abort listener after the caller replaces its signal option`, async () => {
    const controller = new AbortController()
    const replacement = new AbortController()
    const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
    const options = { channel: "ops", signal: controller.signal, maxQueuedEvents: 1 }
    const events = gateway.events(options)
    try {
      expect(getEventListeners(controller.signal, "abort")).toHaveLength(1)
      options.signal = replacement.signal
      if (close === "return") await events.return()
      else if (close === "shutdown") await gateway.stop()
      else {
        gateway.emit({ channel: "ops", content: "first" })
        gateway.emit({ channel: "ops", content: "overflow" })
        await expect(events.next()).rejects.toThrow("overflow")
      }
      expect(getEventListeners(controller.signal, "abort")).toEqual([])
      expect(getEventListeners(replacement.signal, "abort")).toEqual([])
      expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    } finally {
      await gateway.stop()
    }
  })
}

test("a signal getter cannot change the abort source between subscription checks and attachment", async () => {
  const controller = new AbortController()
  const replacement = new AbortController()
  let reads = 0
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
  const events = gateway.events({
    channel: "ops",
    get signal() {
      return reads++ === 0 ? controller.signal : replacement.signal
    },
  })
  try {
    const pending = events.next()
    controller.abort()
    gateway.emit({ channel: "ops", content: "after cancellation" })
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(getEventListeners(replacement.signal, "abort")).toEqual([])
  } finally {
    await gateway.stop()
  }
})

test("revoking access to the options object after creation cannot break subscription cleanup", async () => {
  const controller = new AbortController()
  let revoked = false
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
  const events = gateway.events({
    channel: "ops",
    get signal() {
      if (revoked) throw new Error("options are no longer readable")
      return controller.signal
    },
  })
  const pending = events.next()
  try {
    revoked = true
    await events.return()
    expect(await pending).toEqual({ done: true, value: undefined })
    expect(getEventListeners(controller.signal, "abort")).toEqual([])
    expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
  } finally {
    revoked = false
    await gateway.stop()
  }
})
