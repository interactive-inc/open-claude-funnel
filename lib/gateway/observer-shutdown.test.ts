import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"

for (const action of ["stop", "dispose", "abort"] as const) {
  test(`${action} releases observers and refuses new registrations`, async () => {
    const controller = new AbortController()
    const gateway = new Funnel({
      channels: [{ name: "ops" }],
      signal: controller.signal,
    }).gatewayModule({ token: "" })
    const unsubscribe = gateway.onEvent(() => {})
    expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(1)
    try {
      if (action === "stop") void gateway.stop()
      else if (action === "dispose") gateway.dispose()
      else controller.abort()
      expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
      expect(() => gateway.onEvent(() => {})).toThrow("gateway is stopped")
      expect(() => unsubscribe()).not.toThrow()
    } finally {
      await gateway.stop()
    }
  })
}

test("stopping from an observer drops queued notifications and releases every callback", async () => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
  const seen: string[] = []
  gateway.onEvent((event) => {
    if (event.content === "original") {
      gateway.emit({ channel: "ops", content: "derived" })
      void gateway.stop()
    }
  })
  gateway.onEvent((event) => {
    seen.push(event.content)
  })
  try {
    gateway.emit({ channel: "ops", content: "original" })
    expect(seen).toEqual([])
    expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
  } finally {
    await gateway.stop()
  }
})
