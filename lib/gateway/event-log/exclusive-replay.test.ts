import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Funnel } from "@/funnel"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import type { FunnelEventLog } from "@/gateway/event-log/event-log"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

const stores: Array<{ name: string; create: () => FunnelEventLog }> = [
  { name: "memory", create: () => new MemoryFunnelEventLog() },
  { name: "sqlite", create: () => new SqliteFunnelEventLog({ path: ":memory:" }) },
]

describe.each(stores)("exclusive replay with $name", (store) => {
  test("an offline event is claimed once, including after the module is recreated", () => {
    const log = store.create()
    try {
      const funnel = new Funnel({ fs: new MemoryFunnelFileSystem(), dir: "/replay-test" })
      const channel = funnel.channels.add({ name: "ops", delivery: "exclusive" })
      const gateway = funnel.gatewayModule({ eventLog: log, token: "", killCompetingSlack: false })
      gateway.emit({ channel: "ops", content: "queued" })
      gateway.emit({ channel: "ops", content: "for bob", meta: { target: "bob" } })
      const alice: Parameters<FunnelBroadcaster["replaySince"]>[1] = {
        channel: channel.id,
        connectors: [],
        delivery: "exclusive",
        subscriberId: "alice",
      }
      expect(
        gateway
          .getBroadcaster()
          .replaySince(0, alice)
          .map((event) => event.content),
      ).toEqual(["queued"])

      const restarted = funnel.gatewayModule({
        eventLog: log,
        token: "",
        killCompetingSlack: false,
      })
      expect(
        restarted
          .getBroadcaster()
          .replaySince(0, { ...alice, subscriberId: "bob" })
          .map((event) => event.content),
      ).toEqual(["for bob"])
      expect(
        restarted
          .getBroadcaster()
          .replaySince(0, alice)
          .map((event) => event.content),
      ).toEqual(["queued"])
    } finally {
      log.close()
    }
  })
})

test("SQLite preserves assigned recipients, claims and complete content across reopen", () => {
  const directory = mkdtempSync(join(tmpdir(), "funnel-exclusive-"))
  const path = join(directory, "events.db")
  const content = "長い本文".repeat(1000) + "末尾"
  const first = new SqliteFunnelEventLog({ path })
  try {
    first.record({
      offset: 1,
      channelId: "ops",
      connectorId: null,
      content,
      meta: { channelId: "ops" },
      exclusive: { ops: "alice" },
    })
    first.record({
      offset: 2,
      channelId: "ops",
      connectorId: null,
      content: "queued",
      meta: { channelId: "ops" },
      exclusive: { ops: null },
    })
    expect(first.claimExclusive(2, "ops", "bob")).toBe(true)
  } finally {
    first.close()
  }
  const reopened = new SqliteFunnelEventLog({ path })
  try {
    const broadcaster = new FunnelBroadcaster({ persistentReplay: reopened })
    const subscription: Parameters<FunnelBroadcaster["replaySince"]>[1] = {
      channel: "ops",
      connectors: [],
      delivery: "exclusive",
      subscriberId: "alice",
    }
    expect(broadcaster.replaySince(0, subscription).map((event) => event.content)).toEqual([
      content,
    ])
    expect(
      broadcaster
        .replaySince(0, { ...subscription, subscriberId: "bob" })
        .map((event) => event.content),
    ).toEqual(["queued"])
    expect(reopened.claimExclusive(99, "ops", "alice")).toBe(false)
    reopened.clear()
    reopened.record({
      offset: 2,
      channelId: "ops",
      connectorId: null,
      content: "new",
      meta: { channelId: "ops" },
      exclusive: { ops: null },
    })
    expect(reopened.claimExclusive(2, "ops", "alice")).toBe(true)
  } finally {
    reopened.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
