import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

for (const storage of ["memory", "file"] as const) {
  for (const [label, worker] of [
    ["reversed", "\udfff\udbff"],
    ["low", "\udfff\udfff"],
    ["mixed", "😀\udfff\udfff"],
  ] as const) {
    test(`${storage} exclusive claims preserve ${label} surrogate worker IDs`, () => {
      const directory = mkdtempSync(join(tmpdir(), "funnel-unicode-claims-"))
      const path = storage === "memory" ? ":memory:" : join(directory, "events.db")
      const log = new SqliteFunnelEventLog({ path })
      try {
        log.record({
          offset: 1,
          content: "input",
          channelId: "ops",
          connectorId: null,
          meta: null,
          exclusive: { ops: null },
        })
        expect(log.claimExclusive(1, "ops", worker)).toBe(true)
        expect(log.claimExclusive(1, "ops", "other-worker")).toBe(false)
        expect(log.claimExclusive(1, "ops", worker)).toBe(true)
        if (storage === "file") {
          log.close()
          const reopened = new SqliteFunnelEventLog({ path })
          try {
            expect(reopened.claimExclusive(1, "ops", "other-worker")).toBe(false)
            expect(reopened.claimExclusive(1, "ops", worker)).toBe(true)
          } finally {
            reopened.close()
          }
        }
      } finally {
        log.close()
        rmSync(directory, { recursive: true, force: true })
      }
    })
  }
}

test("global event claims keep surrogate channel IDs distinct", () => {
  const first = "\udfff\udbff"
  const second = "\udfff\udfff"
  const log = new SqliteFunnelEventLog({ path: ":memory:" })
  try {
    log.record({
      offset: 1,
      content: "global",
      channelId: null,
      connectorId: null,
      meta: null,
      exclusive: { [first]: null, [second]: null },
    })
    expect(log.claimExclusive(1, first, "first-worker")).toBe(true)
    expect(log.claimExclusive(1, second, "second-worker")).toBe(true)
    expect(log.claimExclusive(1, first, "second-worker")).toBe(false)
    expect(log.claimExclusive(1, second, "first-worker")).toBe(false)
  } finally {
    log.close()
  }
})
