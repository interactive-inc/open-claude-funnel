import { expect, test } from "bun:test"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { slackConnector } from "@/engine/connectors/slack-connector"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"

for (const operation of ["add", "update", "operation"] as const) {
  for (const duplicate of [false, true]) {
    test(`${operation} ${duplicate ? "rejects reused" : "accepts distinct"} credentials from a reused descriptor buffer`, () => {
      const descriptor = slackConnector()
      const buffer: string[] = []
      const connector = (suffix: string) => ({
        id: "source",
        type: "slack",
        name: "source",
        botToken: `xoxb-${suffix}`,
        appToken: `xapp-${suffix}`,
      })
      const store = new MemoryFunnelSettingsStore({
        channels: [
          { id: "first", name: "first", delivery: "fanout", connectors: [connector("first")] },
          {
            id: "second",
            name: "second",
            delivery: "fanout",
            connectors: operation === "add" ? [] : [connector("second")],
          },
        ],
      })
      const channels = new FunnelChannels({
        store,
        registry: new FunnelConnectorRegistry({
          descriptors: [
            {
              ...descriptor,
              secretTokens(config) {
                buffer.splice(0, buffer.length, ...descriptor.secretTokens(config))
                return buffer
              },
              operations: {
                rotate: ({ config, args }) => ({
                  config: { ...config, botToken: args },
                  result: "updated",
                }),
              },
            },
          ],
        }),
        idGenerator: { generate: () => "source" },
      })
      const before = store.read()
      const token = duplicate ? "xoxb-first" : "xoxb-third"
      const run = () => {
        if (operation === "add")
          return channels.addConnector("second", {
            type: "slack",
            name: "source",
            botToken: token,
            appToken: "xapp-third",
          })
        if (operation === "update")
          return channels.updateConnector("second", "source", { botToken: token })
        return channels.connectorOp("second", "source", "rotate", token)
      }
      if (duplicate) {
        expect(run).toThrow("token already in use")
        expect(store.read()).toEqual(before)
      } else {
        run()
        expect(channels.getConnector("second", "source")).toMatchObject({ botToken: token })
        expect(channels.getConnector("first", "source")).toMatchObject({ botToken: "xoxb-first" })
      }
    })
  }
}
