import { describe, expect, test } from "bun:test"
import { timeChannel } from "@/engine/channel/time-channel"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import type { FlumeTimeSourceState } from "@interactive-inc/flume"
const context = {
  channelId: "clock",
  channelName: "clock",
  signal: new AbortController().signal,
  logger: new MemoryFunnelLogger(),
  clock: new MemoryFunnelClock(),
}
describe("time channel state ownership", () => {
  test("builds a time source without a directory or persistence", async () => {
    const runtime = await timeChannel({ id: "clock", cron: "* * * * *" }).build(context)
    expect(runtime.sources).toHaveLength(1)
  })
  test("hands explicit host state to the time source for catch-up", async () => {
    const calls: string[] = []
    let state: FlumeTimeSourceState | null = { lastFiredAt: Date.now() - 120000 }
    const runtime = await timeChannel({
      id: "clock",
      cron: "* * * * *",
      statePersister: {
        load: async () => {
          calls.push("load")
          return state
        },
        save: async (value) => {
          calls.push("save")
          state = value
        },
      },
    }).build(context)
    const { Flume } = await import("@interactive-inc/flume")
    const running = await new Flume({ sources: runtime.sources }).open()
    if (running instanceof Error) throw running
    await running.close()
    await running.drain()
    expect(calls).toContain("load")
  })
})
