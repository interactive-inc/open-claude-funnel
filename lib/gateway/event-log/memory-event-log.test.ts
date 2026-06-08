import { describe, expect, it } from "vitest"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"

const record = (log: MemoryFunnelEventLog, offset: number, content: string) => {
  log.record({ content, channelId: "c1", connectorId: null, meta: null, offset })
}

describe("MemoryFunnelEventLog", () => {
  it("records events and replays those strictly after `since`", () => {
    const log = new MemoryFunnelEventLog()

    record(log, 1, "a")
    record(log, 2, "b")
    record(log, 3, "c")

    const replayed = log.loadSince(1)

    expect(replayed.map((event) => event.content)).toEqual(["b", "c"])
    expect(replayed.map((event) => event.offset)).toEqual([2, 3])
  })

  it("reports the max offset, and 0 when empty", () => {
    const log = new MemoryFunnelEventLog()

    expect(log.findMaxOffset()).toEqual(0)

    record(log, 5, "a")
    record(log, 9, "b")

    expect(log.findMaxOffset()).toEqual(9)
  })

  it("carries meta through replay as undefined when absent", () => {
    const log = new MemoryFunnelEventLog()

    log.record({ content: "x", channelId: null, connectorId: null, meta: { k: "v" }, offset: 1 })
    log.record({ content: "y", channelId: null, connectorId: null, meta: null, offset: 2 })

    const replayed = log.loadSince(0)

    expect(replayed[0]?.meta).toEqual({ k: "v" })
    expect(replayed[1]?.meta).toBeUndefined()
  })
})
