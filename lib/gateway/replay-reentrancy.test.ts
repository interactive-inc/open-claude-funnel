import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { FunnelEventStream, type FunnelEventSubscription } from "@/gateway/event-stream"

for (const phase of ["load", "claim"] as const) {
  test(`a read requested during replay ${phase} waits for the running generator`, async () => {
    let subscription: FunnelEventSubscription
    let nested: ReturnType<FunnelEventSubscription["next"]> | undefined
    let requested = false
    const requestNext = () => {
      if (requested) return
      requested = true
      nested = subscription.next()
      void nested.catch(() => {})
    }
    const broadcaster = new FunnelBroadcaster({
      replayBufferSize: 0,
      persistentReplay: {
        loadSince(since) {
          if (phase === "load") requestNext()
          return [1, 2]
            .filter((offset) => offset > since)
            .map((offset) => ({
              offset,
              content: `history-${offset}`,
              exclusive: { ops: null },
            }))
        },
        claimExclusive() {
          if (phase === "claim") requestNext()
          return true
        },
      },
    })
    broadcaster.seedLatestOffset(2)
    subscription = broadcaster.events(
      {
        channel: "ops",
        connectors: [],
        delivery: "exclusive",
        subscriberId: "worker",
      },
      { since: 0 },
    )
    try {
      const first = subscription.next()
      const outcomes = await Promise.allSettled([first, nested!])
      expect(outcomes.map((outcome) => outcome.status)).toEqual(["fulfilled", "fulfilled"])
      expect(await first).toMatchObject({ done: false, value: { offset: 1 } })
      expect(await nested).toMatchObject({ done: false, value: { offset: 2 } })
      expect(broadcaster.getMetrics().subscribers).toBe(1)
    } finally {
      await subscription.return()
    }
  })
}

test("reentrant reads cannot overtake the running read at the live queue boundary", async () => {
  let nested: ReturnType<FunnelEventSubscription["next"]> | undefined
  const stream = new FunnelEventStream({}, () => {}, {
    next() {
      nested = stream.next()
      stream.push({ offset: 1, content: "first live" })
      stream.push({ offset: 2, content: "second live" })
      return { done: true, value: undefined }
    },
  })
  try {
    expect(await stream.next()).toMatchObject({ done: false, value: { offset: 1 } })
    expect(await nested).toMatchObject({ done: false, value: { offset: 2 } })
  } finally {
    await stream.return()
  }
})

test("cancellation during replay settles reentrant reads without claiming more history", async () => {
  let nested: ReturnType<FunnelEventSubscription["next"]> | undefined
  let closed = 0
  function* replay() {
    nested = stream.next()
    void stream.return()
    yield { offset: 1, content: "cancelled" }
  }
  const stream = new FunnelEventStream(
    {},
    () => {
      closed++
    },
    replay(),
  )
  expect(await stream.next()).toEqual({ done: true, value: undefined })
  expect(await nested).toEqual({ done: true, value: undefined })
  expect(closed).toBe(1)
})

test("a replay failure rejects both the running and reentrant read with the original error", async () => {
  let nested: ReturnType<FunnelEventSubscription["next"]> | undefined
  const failure = new Error("History unavailable")
  const stream = new FunnelEventStream({}, () => {}, {
    next() {
      nested = stream.next()
      throw failure
    },
  })
  const first = stream.next()
  const outcomes = await Promise.allSettled([first, nested!])
  expect(outcomes).toEqual([
    { status: "rejected", reason: failure },
    { status: "rejected", reason: failure },
  ])
})
