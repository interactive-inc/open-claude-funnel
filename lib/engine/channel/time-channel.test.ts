import { describe, expect, test } from "bun:test"
import { timeChannel } from "@/engine/channel/time-channel"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { Flume, createFlumeDefaultDeps, type FlumeTimeSourceState } from "@interactive-inc/flume"
const context = {
  channelId: "clock",
  channelName: "clock",
  signal: new AbortController().signal,
  logger: new MemoryFunnelLogger(),
  clock: new MemoryFunnelClock(),
}
describe("time channel state ownership", () => {
  test("captures the source settings once and preserves the host state receiver across builds", async () => {
    class State {
      #loads = 0
      async load() {
        this.#loads++
        return null
      }
      async save() {}
      get loads() {
        return this.#loads
      }
    }
    const state = new State()
    let reads = 0
    let idReads = 0
    const transform = () => ({ content: "original" })
    const options = {
      get id() {
        idReads++
        return "clock"
      },
      cron: "* * * * *",
      transform,
      get statePersister() {
        reads++
        return reads === 1 ? state : undefined
      },
    }
    const channel = timeChannel(options)
    options.cron = "invalid"
    options.transform = () => ({ content: "replacement" })
    for (let index = 0; index < 2; index++) {
      const runtime = await channel.build(context)
      expect(runtime.transform).toBe(transform)
      const running = await new Flume({ sources: runtime.sources }).open()
      if (running instanceof Error) throw running
      await running.close()
      await running.drain()
    }
    expect(state.loads).toBe(2)
    expect(reads).toBe(1)
    expect(idReads).toBe(1)
  })

  test("captures the catch-up policy rather than retaining the caller's mutable object", async () => {
    const now = Date.UTC(2026, 0, 1, 12)
    const policy: { mode: "missed"; maxWindowMs: number } = { mode: "missed", maxWindowMs: 120000 }
    const channel = timeChannel({
      id: "clock",
      cron: "* * * * *",
      catchupPolicy: policy,
      statePersister: { load: async () => ({ lastFiredAt: now - 120000 }), save: async () => {} },
    })
    policy.maxWindowMs = 0
    const runtime = await channel.build(context)
    let ticks = 0
    const running = await new Flume({
      sources: runtime.sources,
      deps: { ...createFlumeDefaultDeps(), now: () => now, setTimeout: () => 0, clearTimeout() {} },
      onEvent: (item) => {
        if (item.kind === "event") ticks++
      },
    }).open()
    if (running instanceof Error) throw running
    await running.close()
    await running.drain()
    expect(ticks).toBe(2)
  })

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
    const running = await new Flume({ sources: runtime.sources }).open()
    if (running instanceof Error) throw running
    await running.close()
    await running.drain()
    expect(calls).toContain("load")
  })
})
