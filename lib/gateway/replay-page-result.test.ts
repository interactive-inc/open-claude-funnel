import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"

const subscriber = { channel: "ops", connectors: [] }
const retained = { offset: 1, content: "retained", meta: { channelId: "ops" } }

for (const mode of ["direct", "native"] as const) {
  for (const kind of ["resolved", "rejected", "hidden-then", "thenable"] as const) {
    test(`${mode} replay rejects a ${kind} asynchronous page and can recover`, async () => {
      const failure = new Error("replay storage unavailable")
      const reported: unknown[] = []
      let invalid = true
      const broadcaster = new FunnelBroadcaster({
        persistentReplay: {
          loadSince(since) {
            if (!invalid) return since === 0 ? [retained] : []
            if (kind === "thenable")
              return {
                // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied asynchronous page.
                then(_resolve: unknown, reject: (error: unknown) => void) {
                  reject(failure)
                },
              } as never
            const result = kind === "resolved" ? Promise.resolve([]) : Promise.reject(failure)
            // Keep the regression safe on the old implementation; reporting is still asserted below.
            void result.catch(() => {})
            if (kind === "hidden-then") {
              // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise with a hidden then method.
              Object.defineProperty(result, "then", { value: undefined })
            }
            return result as never
          },
        },
        onError: (error, context) => {
          reported.push({ error, context })
        },
      })
      broadcaster.seedLatestOffset(1)
      if (mode === "direct") {
        expect(() => broadcaster.replaySince(0, subscriber)).toThrow(
          "event log replay must return an array synchronously",
        )
      } else {
        const stream = broadcaster.events(subscriber, { since: 0 })
        try {
          await expect(stream.next()).rejects.toThrow(
            "event log replay must return an array synchronously",
          )
          expect(broadcaster.getMetrics().subscribers).toBe(0)
        } finally {
          await stream.return()
        }
      }
      await Bun.sleep(0)
      expect(reported).toEqual(
        kind === "resolved"
          ? []
          : [
              {
                error: failure,
                context: { component: "broadcaster.replay-query", since: 0, channelId: "ops" },
              },
            ],
      )
      invalid = false
      expect(broadcaster.replaySince(0, subscriber)).toEqual([retained])
      const restored = broadcaster.events(subscriber, { since: 0 })
      try {
        expect((await restored.next()).value).toEqual(retained)
        broadcaster.broadcast("live", { channelId: "ops" })
        expect((await restored.next()).value?.content).toBe("live")
      } finally {
        await restored.return()
      }
      expect(broadcaster.getMetrics().subscribers).toBe(0)
    })
  }
}

for (const [kind, result] of [
  ["null", null],
  ["undefined", undefined],
  ["error", new Error("storage failed")],
  ["empty array-like", { length: 0 }],
  ["string", ""],
  ["iterable", new Set([retained])],
] as const) {
  test(`replay rejects a ${kind} page without treating it as empty history`, () => {
    const broadcaster = new FunnelBroadcaster({
      persistentReplay: { loadSince: () => result as never },
    })
    expect(() => broadcaster.replaySince(0, subscriber)).toThrow(
      "event log replay must return an array synchronously",
    )
  })
}
