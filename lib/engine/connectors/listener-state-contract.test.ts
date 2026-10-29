import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"

for (const kind of ["undefined", "null", "number", "string", "promise", "thenable"] as const) {
  test(`invalid ${kind} health results are reported without restarting an unevaluable source`, async () => {
    const failure = new Error("original health rejection")
    const invalid = () => {
      if (kind === "undefined") return undefined
      if (kind === "null") return null
      if (kind === "number") return 0
      if (kind === "string") return "false"
      if (kind === "promise") return Promise.reject(failure)
      return {
        // oxlint-disable-next-line unicorn/no-thenable -- Exercise an asynchronous host health method.
        then(_resolve: unknown, reject: (error: unknown) => void) {
          reject(failure)
        },
      }
    }
    const sources = {
      broken: { starts: 0, stops: 0, alive: true },
      dead: { starts: 0, stops: 0, alive: true },
    }
    const reports: Error[] = []
    const configs = Object.keys(sources).map((name) => ({ id: name, name, type: "source" }))
    let evaluate = false
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () =>
          configs.map((config) => ({ ...config, channelId: "channel", channelName: "channel" })),
        createListener: (_channel, name) => {
          const state = sources[name as keyof typeof sources]
          return {
            config: configs.find((config) => config.name === name)!,
            channelId: "channel",
            listener: {
              async start() {
                state.starts++
                state.alive = true
              },
              async stop() {
                state.stops++
                state.alive = false
              },
              isAlive: () =>
                evaluate && name === "broken" ? (invalid() as unknown as boolean) : state.alive,
              isConnected: () => state.alive,
            },
          }
        },
      },
      notify: async () => {},
      sleep: async () => {},
      onError: (error) => {
        reports.push(error)
      },
    })
    try {
      await registry.startAll()
      sources.dead.alive = false
      evaluate = true
      await registry.runHealthCheckForTest()
      await Bun.sleep(0)
      expect(sources.broken.starts).toBe(1)
      expect(sources.broken.stops).toBe(0)
      expect(sources.dead.starts).toBe(2)
      expect(
        reports.some(
          (error) => error.message === "listener isAlive must return a boolean synchronously",
        ),
      ).toBe(true)
      if (kind === "promise" || kind === "thenable") expect(reports).toContain(failure)
    } finally {
      await registry.close()
    }
  })
}

for (const method of ["isAlive", "isConnected"] as const) {
  for (const kind of ["undefined", "promise"] as const) {
    test(`listener listing rejects ${kind} ${method} results and observes late failures`, async () => {
      const deferred = Promise.withResolvers<boolean>()
      const failure = new Error("late state rejection")
      const reports: Error[] = []
      const listener = {
        async start() {},
        async stop() {},
        isAlive: () => true,
        isConnected: () => true,
        [method]: () => (kind === "promise" ? deferred.promise : undefined) as unknown as boolean,
      }
      const config = { id: "source", name: "source", type: "source" }
      const registry = new FunnelListenerRegistry({
        channels: {
          listAllConnectors: () => [{ ...config, channelId: "channel", channelName: "channel" }],
          createListener: () => ({ config, channelId: "channel", listener }),
        },
        notify: async () => {},
        onError: (error) => {
          reports.push(error)
        },
      })
      try {
        expect((await registry.start("channel", "source")).ok).toBe(true)
        expect(() => registry.list()).toThrow(
          `listener ${method} must return a boolean synchronously`,
        )
        if (kind === "promise") {
          deferred.reject(failure)
          await Bun.sleep(0)
          expect(reports).toContain(failure)
        }
      } finally {
        await registry.close()
      }
    })
  }
}
