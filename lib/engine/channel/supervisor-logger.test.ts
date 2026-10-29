import { expect, test } from "bun:test"
import { FunnelChannelSupervisor } from "@/engine/channel/channel-supervisor"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

for (const failure of ["sync", "async"] as const) {
  for (const phase of ["initial", "late"] as const) {
    test(`${failure} logger failures cannot retain a broken ${phase} channel or block replacement`, async () => {
      class Logger extends MemoryFunnelLogger {
        override error(): void {
          if (failure === "sync") throw new Error("logger unavailable")
          return Promise.reject(new Error("logger unavailable")) as never
        }
      }
      const supervisor = new FunnelChannelSupervisor({
        broadcaster: { broadcast() {} },
        logger: new Logger(),
        clock: new MemoryFunnelClock(),
      })
      let healthyBuilds = 0
      supervisor.register({
        id: "healthy",
        build: () => {
          healthyBuilds++
          return { sources: [] }
        },
      })
      try {
        if (phase === "late") await supervisor.start()
        supervisor.register({
          id: "broken",
          build: () => {
            throw new Error("build failed")
          },
        })
        if (phase === "initial") await expect(supervisor.start()).resolves.toBeUndefined()
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(supervisor.has("broken")).toBe(false)
        expect(supervisor.has("healthy")).toBe(true)
        expect(healthyBuilds).toBe(1)
        supervisor.register({ id: "broken", build: () => ({ sources: [] }) })
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(supervisor.ids()).toContain("broken")
      } finally {
        await supervisor.stop()
      }
    })
  }
}

for (const failure of ["sync", "async"] as const) {
  test(`a ${failure} build-context logger failure cannot fail an otherwise valid build`, async () => {
    class Logger extends MemoryFunnelLogger {
      override error(): void {
        if (failure === "sync") throw new Error("logger unavailable")
        return Promise.reject(new Error("logger unavailable")) as never
      }
    }
    const supervisor = new FunnelChannelSupervisor({
      broadcaster: { broadcast() {} },
      logger: new Logger(),
      clock: new MemoryFunnelClock(),
    })
    supervisor.register({
      id: "source",
      build(ctx) {
        ctx.logger.error("building source")
        return { sources: [] }
      },
    })
    try {
      await supervisor.start()
      expect(supervisor.has("source")).toBe(true)
      expect(supervisor.ids()).toContain("source")
      await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      await supervisor.stop()
    }
  })
}
