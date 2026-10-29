import { expect, test } from "bun:test"
import { FunnelBroadcaster, type ReplayableEvent } from "@/gateway/broadcaster"

const client = { channel: "channel", connectors: [], subscriberId: "worker" }

test("replay validates and advances the same captured offset that it delivers", () => {
  let reads = 0
  const cursors: number[] = []
  const event: ReplayableEvent = {
    content: "input",
    get offset() {
      return ++reads <= 4 ? 1 : -1
    },
  }
  const broadcaster = new FunnelBroadcaster({
    persistentReplay: {
      loadSince(since) {
        cursors.push(since)
        return cursors.length === 1 ? [event] : []
      },
    },
  })
  expect(broadcaster.replaySince(0, client)).toEqual([
    { content: "input", offset: 1, meta: undefined },
  ])
  expect(cursors).toEqual([0, 1])
  expect(reads).toBe(1)
})

test("replay routing and delivery share one metadata snapshot", () => {
  let reads = 0
  const event: ReplayableEvent = {
    content: "input",
    offset: 1,
    get meta() {
      return ++reads === 1 ? { channelId: "other" } : { channelId: "channel" }
    },
  }
  const broadcaster = new FunnelBroadcaster({
    persistentReplay: { loadSince: (since) => (since === 0 ? [event] : []) },
  })
  expect(broadcaster.replaySince(0, client)).toEqual([])
  expect(reads).toBe(1)
})

test("exclusive claim callbacks cannot rewrite an already matched replay event", () => {
  const event = {
    content: "original",
    offset: 1,
    meta: { channelId: "channel" },
    exclusive: { channel: null },
  }
  const claims: unknown[][] = []
  const broadcaster = new FunnelBroadcaster({
    persistentReplay: {
      loadSince: (since) => (since === 0 ? [event] : []),
      claimExclusive(...args) {
        claims.push(args)
        event.content = "changed"
        event.offset = 999
        event.meta.channelId = "other"
        return true
      },
    },
  })
  expect(broadcaster.replaySince(0, { ...client, delivery: "exclusive" })).toEqual([
    {
      content: "original",
      offset: 1,
      meta: { channelId: "channel" },
      exclusive: { channel: null },
    },
  ])
  expect(claims).toEqual([[1, "channel", "worker"]])
})
