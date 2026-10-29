import { expect, test } from "bun:test"
import { Funnel, type FunnelOptions } from "@/funnel"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

for (const kind of ["module", "server"] as const) {
  test(`${kind} retains the Funnel's original cancellation source after options are mutated`, async () => {
    const original = new AbortController()
    const replacement = new AbortController()
    const options: FunnelOptions = { signal: original.signal, channels: [{ name: "ops" }] }
    const funnel = new Funnel(options)
    options.signal = replacement.signal
    const gateway =
      kind === "module"
        ? funnel.gatewayModule({ token: "" })
        : funnel.gatewayServer({ token: "", port: 0 })
    try {
      await gateway.start()
      original.abort()
      expect(() =>
        gateway.emit({ channel: "ops", content: "after original cancellation" }),
      ).toThrow("stopped")
    } finally {
      await gateway.stop()
    }
  })

  test(`${kind} does not adopt a replacement cancellation source`, async () => {
    const original = new AbortController()
    const replacement = new AbortController()
    const options: FunnelOptions = { signal: original.signal, channels: [{ name: "ops" }] }
    const funnel = new Funnel(options)
    options.signal = replacement.signal
    const gateway =
      kind === "module"
        ? funnel.gatewayModule({ token: "" })
        : funnel.gatewayServer({ token: "", port: 0 })
    try {
      await gateway.start()
      replacement.abort()
      expect(gateway.emit({ channel: "ops", content: "original remains active" })).toEqual({
        offset: 1,
      })
    } finally {
      await gateway.stop()
    }
  })
}

test("later gateways keep using the original injected clock object", async () => {
  const original = new MemoryFunnelClock({ start: new Date(1000) })
  const options: FunnelOptions = { clock: original, channels: [{ name: "ops" }] }
  const funnel = new Funnel(options)
  options.clock = new MemoryFunnelClock({ start: new Date(5000) })
  const gateway = funnel.gatewayModule({ token: "" })
  try {
    original.advance(500)
    gateway.emit({ channel: "ops", content: "entry" })
    expect(gateway.getBroadcaster().getMetrics().lastBroadcastAt).toBe(new Date(1500).toISOString())
  } finally {
    await gateway.stop()
  }
})

test("options getters are captured during construction and are not re-read for each gateway", async () => {
  const original = new AbortController()
  const replacement = new AbortController()
  let reads = 0
  const funnel = new Funnel({
    channels: [{ name: "ops" }],
    get signal() {
      return reads++ === 0 ? original.signal : replacement.signal
    },
  })
  const first = funnel.gatewayModule({ token: "" })
  const second = funnel.gatewayModule({ token: "" })
  try {
    original.abort()
    expect(() => first.emit({ channel: "ops", content: "late" })).toThrow("stopped")
    expect(() => second.emit({ channel: "ops", content: "late" })).toThrow("stopped")
  } finally {
    await first.stop()
    await second.stop()
  }
})

test("prototype-defined dependency getters remain supported", async () => {
  const controller = new AbortController()
  class Options implements FunnelOptions {
    channels = [{ name: "ops" }]
    get signal(): AbortSignal {
      return controller.signal
    }
  }
  const gateway = new Funnel(new Options()).gatewayModule({ token: "" })
  try {
    controller.abort()
    expect(() => gateway.emit({ channel: "ops", content: "late" })).toThrow("stopped")
  } finally {
    await gateway.stop()
  }
})
