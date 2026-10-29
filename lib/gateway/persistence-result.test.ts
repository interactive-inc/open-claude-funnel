import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { Funnel } from "@/funnel"

for (const kind of ["promise", "thenable", "error"] as const) {
  test(`${kind} persistence results cannot report a successful publication or reach consumers`, async () => {
    const seen: string[] = []
    const broadcaster = new FunnelBroadcaster({
      record: () => {
        if (kind === "promise") return Promise.resolve()
        if (kind === "thenable")
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
            then(resolve: () => void) {
              resolve()
            },
          }
        return new Error("persistence failed")
      },
    })
    const events = broadcaster.events({ channel: "ops", connectors: [] })
    broadcaster.subscribe((event) => {
      seen.push(event.content)
    })
    try {
      expect(() => broadcaster.broadcast("input")).toThrow(
        kind === "error" ? "persistence failed" : "event persistence must be synchronous",
      )
      expect(seen).toEqual([])
      expect(broadcaster.getMetrics().eventsBroadcast).toBe(0)
      expect(broadcaster.replaySince(0, { channel: "ops", connectors: [] })).toEqual([])
      const next = events.next()
      await events.return()
      expect(await next).toEqual({ done: true, value: undefined })
    } finally {
      await events.return()
    }
  })
}

test("gateway event-log results are preserved for the broadcaster's failure checks", async () => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
  try {
    gateway.getEventLog().record = async () => {}
    expect(() => gateway.emit({ channel: "ops", content: "input" })).toThrow(
      "event persistence must be synchronous",
    )
    expect(gateway.getBroadcaster().getMetrics().eventsBroadcast).toBe(0)
  } finally {
    await gateway.stop()
  }
})

for (const kind of ["promise", "thenable"] as const) {
  test(`late ${kind} persistence failures reach the host reporter without delivering`, async () => {
    const errors: string[] = []
    const broadcaster = new FunnelBroadcaster({
      record: () =>
        kind === "promise"
          ? Promise.reject(new Error("late persistence failure"))
          : {
              // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
              then(_resolve: unknown, reject: (error: Error) => void) {
                reject(new Error("late persistence failure"))
              },
            },
      onError: (error) => {
        errors.push(error.message)
      },
    })
    expect(() => broadcaster.broadcast("input")).toThrow("event persistence must be synchronous")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(errors).toEqual(["late persistence failure"])
    expect(broadcaster.getMetrics().eventsBroadcast).toBe(0)
  })
}
