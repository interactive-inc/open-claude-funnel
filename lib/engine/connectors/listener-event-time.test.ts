import { expect, test } from "bun:test"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"

for (const [kind, invalidClock] of [
  [
    "throw",
    () => {
      throw new Error("clock unavailable")
    },
  ],
  ["NaN", () => NaN],
  ["infinity", () => Infinity],
  ["out-of-range", () => 8_640_000_000_000_001],
  ["throwing-reporter", () => NaN],
] as const) {
  test(`diagnostic clock failure (${kind}) cannot turn completed delivery into failure`, async () => {
    class Source extends FunnelConnectorListener {
      notify!: NotifyFn
      async start(notify: NotifyFn) {
        this.notify = notify
      }
      async stop() {}
    }
    const source = new Source()
    const config = { id: "source-id", name: "source", type: "example" }
    const delivered: string[] = []
    const reported: Error[] = []
    let clock: () => number = () => 0
    const registry = new FunnelListenerRegistry({
      channels: {
        listAllConnectors: () => [{ ...config, channelId: "ops-id", channelName: "ops" }],
        createListener: () => ({ config, channelId: "ops-id", listener: source }),
      },
      notify: async (_channel, _connector, content) => {
        delivered.push(content)
      },
      now: () => clock(),
      onError: (error) => {
        reported.push(error)
        if (kind === "throwing-reporter") throw new Error("reporter unavailable")
      },
    })
    try {
      expect((await registry.start("ops", "source")).ok).toBe(true)
      await source.notify("first")
      clock = invalidClock
      await expect(source.notify("second")).resolves.toBeUndefined()
      expect(delivered).toEqual(["first", "second"])
      expect(registry.list()[0]).toMatchObject({
        events: 2,
        errors: 0,
        lastEventAt: "1970-01-01T00:00:00.000Z",
      })
      expect(reported).toHaveLength(1)
      clock = () => 1000
      await source.notify("third")
      expect(registry.list()[0]).toMatchObject({
        events: 3,
        errors: 0,
        lastEventAt: "1970-01-01T00:00:01.000Z",
      })
    } finally {
      await registry.close()
    }
  })
}
