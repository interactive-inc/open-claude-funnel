import { expect, test } from "bun:test"
import { FunnelChannelSupervisor } from "@/engine/channel/channel-supervisor"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

for (const reentry of [false, true]) {
  test(`parallel supervisor starts share the entire pending batch (${reentry})`, async () => {
    const supervisor = new FunnelChannelSupervisor({
      broadcaster: { broadcast() {} },
      logger: new MemoryFunnelLogger(),
      clock: new MemoryFunnelClock(),
    })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<{ sources: [] }>()
    let builds = 0
    let nested: Promise<void> | undefined
    supervisor.register({
      id: "fast",
      build() {
        builds++
        return { sources: [] }
      },
    })
    supervisor.register({
      id: "slow",
      build() {
        builds++
        if (reentry) nested = supervisor.start()
        entered.resolve()
        return release.promise
      },
    })
    const first = supervisor.start()
    try {
      await entered.promise
      const second = reentry ? nested! : supervisor.start()
      expect(second).toBe(first)
      let completed = false
      void second.then(() => {
        completed = true
      })
      await Promise.resolve()
      expect(completed).toBe(false)
      release.resolve({ sources: [] })
      await Promise.all([first, second])
      expect(builds).toBe(2)
      expect(supervisor.ids()).toEqual(expect.arrayContaining(["fast", "slow"]))
      await supervisor.start()
      expect(builds).toBe(2)
    } finally {
      release.resolve({ sources: [] })
      await supervisor.stop()
      await first
    }
  })
}

test("stop during shared startup aborts the batch without opening a replacement", async () => {
  const supervisor = new FunnelChannelSupervisor({
    broadcaster: { broadcast() {} },
    logger: new MemoryFunnelLogger(),
    clock: new MemoryFunnelClock(),
  })
  const entered = Promise.withResolvers<AbortSignal>()
  supervisor.register({
    id: "source",
    build: (ctx) => {
      entered.resolve(ctx.signal)
      return new Promise<{ sources: [] }>((resolve) =>
        ctx.signal.addEventListener("abort", () => resolve({ sources: [] }), { once: true }),
      )
    },
  })
  const first = supervisor.start()
  try {
    const signal = await entered.promise
    const second = supervisor.start()
    expect(second).toBe(first)
    await supervisor.stop()
    await Promise.all([first, second])
    await supervisor.start()
    expect(signal.aborted).toBe(true)
    expect(supervisor.ids()).toEqual([])
    expect(supervisor.has("source")).toBe(false)
  } finally {
    await supervisor.stop()
    await first
  }
})
