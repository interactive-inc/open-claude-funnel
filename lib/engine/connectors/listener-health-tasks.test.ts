import { expect, test } from "bun:test"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"

for (const phase of ["recover", "retry"] as const) {
  for (const throwingReporter of [false, true]) {
    test(`${phase} task failure retains the health lock until sibling tasks settle (${throwingReporter})`, async () => {
      class Source extends FunnelConnectorListener {
        starts = 0
        alive = false
        constructor(private readonly failFirst: boolean) {
          super()
        }
        async start() {
          this.starts++
          if (this.failFirst && this.starts === 1) throw new Error("initial failure")
          this.alive = true
        }
        async stop() {
          this.alive = false
        }
        override isAlive() {
          return this.alive
        }
      }
      const sources = {
        first: new Source(phase === "retry"),
        second: new Source(phase === "retry"),
        pending: new Source(true),
      }
      const configs = Object.keys(sources).map((name) => ({ id: name, name, type: "example" }))
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const errors: string[] = []
      let sleeps = 0
      let scans = 0
      const registry = new FunnelListenerRegistry({
        channels: {
          listAllConnectors: () => {
            scans++
            return configs.map((config) => ({ ...config, channelId: "ops-id", channelName: "ops" }))
          },
          createListener: (_channel, name) => ({
            config: configs.find((config) => config.name === name)!,
            channelId: "ops-id",
            listener: sources[name as keyof typeof sources],
          }),
        },
        notify: async () => {},
        sleep: (ms, signal) => {
          if (ms === 30_000)
            return new Promise((resolve) => {
              if (signal?.aborted) resolve()
              else signal?.addEventListener("abort", () => resolve(), { once: true })
            })
          sleeps++
          if (sleeps === 1) return Promise.reject(new Error("backoff failed"))
          if (sleeps === 2) {
            entered.resolve()
            return release.promise
          }
          return Promise.resolve()
        },
        onError: (error) => {
          errors.push(error.message)
          if (throwingReporter) throw new Error("reporter unavailable")
        },
      })
      let health: Promise<void> | undefined
      try {
        await registry.startAll()
        errors.length = 0
        if (phase === "recover") {
          sources.first.alive = false
          sources.second.alive = false
        }
        let completed = false
        health = registry.runHealthCheckForTest()
        void health.then(
          () => {
            completed = true
          },
          () => {
            completed = true
          },
        )
        await entered.promise
        await new Promise((resolve) => setTimeout(resolve, 0))
        expect(completed).toBe(false)
        const before = scans
        await registry.runHealthCheckForTest()
        expect(scans).toBe(before)
        expect(sleeps).toBe(phase === "recover" ? 2 : 3)
        release.resolve()
        await expect(health).resolves.toBeUndefined()
        expect(errors).toContain("backoff failed")
        expect(sources.second.starts).toBe(2)
        expect(sources.pending.starts).toBe(2)
        await registry.runHealthCheckForTest()
        expect(sources.first.starts).toBe(2)
      } finally {
        release.resolve()
        await health?.catch(() => {})
        await registry.close()
      }
    })
  }
}
