import { expect, test } from "bun:test"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"

for (const mode of ["normal", "throwing-reporter", "stop"] as const) {
  test(`a listener state-read failure is isolated during health checks (${mode})`, async () => {
    class Source extends FunnelConnectorListener {
      starts = 0
      stops = 0
      alive = false
      stateError = false
      constructor(private readonly failFirst = false) {
        super()
      }
      async start() {
        this.starts++
        if (this.failFirst && this.starts === 1) throw new Error("initial failure")
        this.alive = true
      }
      async stop() {
        this.stops++
        this.alive = false
      }
      override isAlive() {
        if (this.stateError) throw new Error("state unavailable")
        return this.alive
      }
    }
    const sources = { broken: new Source(), dead: new Source(), retry: new Source(true) }
    const configs = Object.keys(sources).map((name) => ({ id: name, name, type: "example" }))
    const errors: string[] = []
    let stopping: Promise<void> | undefined
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () =>
          configs.map((config) => ({ ...config, channelId: "ops-id", channelName: "ops" })),
        createListener: (_channel, name) => {
          const config = configs.find((config) => config.name === name)!
          return { config, channelId: "ops-id", listener: sources[name as keyof typeof sources] }
        },
      },
      notify: async () => {},
      sleep: async () => {},
      onError: (error) => {
        errors.push(error.message)
        if (error.message !== "state unavailable") return
        if (mode === "stop") stopping = registry.stopAll()
        if (mode === "throwing-reporter") throw new Error("reporter unavailable")
      },
    })
    try {
      await registry.startAll()
      errors.length = 0
      sources.broken.stateError = true
      sources.dead.alive = false
      await expect(registry.runHealthCheckForTest()).resolves.toBeUndefined()
      await stopping
      expect(errors).toContain("state unavailable")
      expect(sources.broken.starts).toBe(1)
      expect(sources.dead.starts).toBe(mode === "stop" ? 1 : 2)
      expect(sources.retry.starts).toBe(mode === "stop" ? 1 : 2)
      if (mode !== "stop") expect(sources.broken.stops).toBe(0)
    } finally {
      await registry.close()
    }
  })
}
