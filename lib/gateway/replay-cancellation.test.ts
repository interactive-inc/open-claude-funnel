import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import type { FunnelEventSubscription } from "@/gateway/event-stream"

for (const cancel of ["return", "close-all", "abort"] as const) {
  for (const phase of ["load", "snapshot", "claim"] as const) {
    test(`${cancel} during replay ${phase} detaches immediately and cannot deliver after cancellation`, async () => {
      let subscription: FunnelEventSubscription
      let completion: Promise<unknown> | undefined
      const controller = new AbortController()
      let claimed = 0
      const failures: unknown[] = []
      const cancelReplay = () => {
        try {
          if (cancel === "return") completion = subscription.return()
          else if (cancel === "close-all") broadcaster.closeEventStreams()
          else controller.abort()
        } catch (error) {
          failures.push(error)
        }
      }
      const broadcaster = new FunnelBroadcaster({
        replayBufferSize: 0,
        persistentReplay: {
          loadSince(since) {
            if (phase === "load") cancelReplay()
            return since < 1
              ? [
                  {
                    offset: 1,
                    get content() {
                      if (phase === "snapshot") cancelReplay()
                      return "history"
                    },
                    exclusive: { ops: null },
                  },
                ]
              : []
          },
          claimExclusive() {
            claimed++
            if (phase === "claim") cancelReplay()
            return true
          },
        },
      })
      broadcaster.seedLatestOffset(1)
      subscription = broadcaster.events(
        {
          channel: "ops",
          connectors: [],
          delivery: "exclusive",
          subscriberId: "worker",
        },
        { since: 0, signal: controller.signal },
      )
      try {
        expect(await subscription.next()).toEqual({ done: true, value: undefined })
        expect(failures).toEqual([])
        await completion
        expect(broadcaster.getMetrics().subscribers).toBe(0)
        expect(claimed).toBe(phase === "claim" ? 1 : 0)
        broadcaster.broadcast("later")
        expect(await subscription.next()).toEqual({ done: true, value: undefined })
      } finally {
        await subscription.return()
      }
    })
  }
}

for (const cancel of ["return", "close-all", "abort"] as const) {
  for (const phase of ["load", "then", "length"] as const) {
    test(`${cancel} during replay page ${phase} cannot start another host iterator`, async () => {
      let subscription: FunnelEventSubscription
      const controller = new AbortController()
      let iterations = 0
      const cancelReplay = () => {
        if (cancel === "return") void subscription.return()
        else if (cancel === "close-all") broadcaster.closeEventStreams()
        else controller.abort()
      }
      const broadcaster = new FunnelBroadcaster({
        persistentReplay: {
          loadSince() {
            const records = [{ offset: 1, content: "history" }]
            records[Symbol.iterator] = () => {
              iterations++
              return records.values()
            }
            if (phase === "load") cancelReplay()
            return new Proxy(records, {
              get(target, key, receiver) {
                if (key === phase) cancelReplay()
                return Reflect.get(target, key, receiver)
              },
            })
          },
        },
      })
      broadcaster.seedLatestOffset(1)
      subscription = broadcaster.events(
        { channel: "ops", connectors: [] },
        { since: 0, signal: controller.signal },
      )
      try {
        expect(await subscription.next()).toEqual({ done: true, value: undefined })
        expect(iterations).toBe(0)
        expect(broadcaster.getMetrics().subscribers).toBe(0)
      } finally {
        await subscription.return()
      }
    })
  }
}
