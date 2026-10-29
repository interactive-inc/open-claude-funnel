import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

const record = (offset: number) => ({
  offset,
  content: "input",
  channelId: "channel",
  connectorId: null,
  meta: null,
  exclusive: { channel: null },
})

test("event history and exclusive claims capture the same path once across reopen", () => {
  const root = mkdtempSync(join(tmpdir(), "replay-options-"))
  const path = join(root, "events.sqlite")
  let reads = 0
  try {
    const log = new SqliteFunnelEventLog({
      get path() {
        return ++reads === 1 ? path : join(root, "other.sqlite")
      },
    })
    try {
      log.record(record(1))
      expect(log.claimExclusive(1, "channel", "first")).toBe(true)
    } finally {
      log.close()
    }
    expect(reads).toBe(1)
    const reopened = new SqliteFunnelEventLog({ path })
    try {
      expect(reopened.claimExclusive(1, "channel", "second")).toBe(false)
      expect(reopened.claimExclusive(1, "channel", "first")).toBe(true)
    } finally {
      reopened.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("replay retention uses the same captured row cap for configuration and pruning", () => {
  let reads = 0
  const log = new SqliteFunnelEventLog({
    path: ":memory:",
    get maxRows() {
      return ++reads === 1 ? 1 : undefined
    },
  })
  try {
    log.record(record(1))
    expect(log.claimExclusive(1, "channel", "first")).toBe(true)
    log.record(record(2))
    expect(log.loadSince(0).map((event) => event.offset)).toEqual([2])
    expect(log.claimExclusive(1, "channel", "first")).toBe(false)
    expect(log.findMaxOffset()).toBe(2)
    expect(reads).toBe(1)
  } finally {
    log.close()
  }
})
