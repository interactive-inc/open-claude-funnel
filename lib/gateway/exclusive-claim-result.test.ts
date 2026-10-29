import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"

for (const [kind, result] of [
  ["error", new Error("claim failed")],
  ["promise", Promise.resolve(false)],
  ["object", {}],
  ["string", "false"],
  ["number", 1],
  ["null", null],
  ["undefined", undefined],
] as const) {
  test(`${kind} claim results are rejected before exclusive replay`, () => {
    const log = new MemoryFunnelEventLog()
    log.record({
      offset: 1,
      content: "offline",
      channelId: "ops",
      connectorId: null,
      meta: null,
      exclusive: { ops: null },
    })
    let invalid = true
    const broadcaster = new FunnelBroadcaster({
      persistentReplay: {
        loadSince: (since, limit) => log.loadSince(since, limit),
        claimExclusive: (offset, channel, subscriber) =>
          invalid ? (result as never) : log.claimExclusive(offset, channel, subscriber),
      },
    })
    broadcaster.seedLatestOffset(1)
    const alice = {
      channel: "ops",
      connectors: [],
      delivery: "exclusive" as const,
      subscriberId: "alice",
    }
    expect(() => broadcaster.replaySince(0, alice)).toThrow(
      kind === "error" ? "claim failed" : "exclusive claim must return a boolean synchronously",
    )
    expect(log.loadSince(0)[0]?.exclusive?.ops).toBeNull()
    invalid = false
    expect(broadcaster.replaySince(0, alice).map((event) => event.content)).toEqual(["offline"])
    expect(broadcaster.replaySince(0, { ...alice, subscriberId: "bob" })).toEqual([])
    log.close()
  })
}

for (const kind of ["promise", "thenable"] as const) {
  test(`a rejected ${kind} claim closes the native subscription and reports its late error`, async () => {
    const errors: string[] = []
    const broadcaster = new FunnelBroadcaster({
      persistentReplay: {
        loadSince: (since) =>
          since === 0
            ? [
                {
                  offset: 1,
                  content: "offline",
                  meta: { channelId: "ops" },
                  exclusive: { ops: null },
                },
              ]
            : [],
        claimExclusive: () =>
          (kind === "promise"
            ? Promise.reject(new Error("late claim failure"))
            : {
                // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
                then(_resolve: unknown, reject: (error: Error) => void) {
                  reject(new Error("late claim failure"))
                },
              }) as never,
      },
      onError: (error) => {
        errors.push(error.message)
      },
    })
    broadcaster.seedLatestOffset(1)
    const stream = broadcaster.events(
      { channel: "ops", connectors: [], delivery: "exclusive", subscriberId: "alice" },
      { since: 0 },
    )
    try {
      await expect(stream.next()).rejects.toThrow(
        "exclusive claim must return a boolean synchronously",
      )
      expect(broadcaster.getMetrics().subscribers).toBe(0)
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(errors).toEqual(["late claim failure"])
    } finally {
      await stream.return()
    }
  })
}
