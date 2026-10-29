import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"

test.each(["source", ""])(
  "listener %s uses stable IDs despite a channel name/ID conflict",
  async (connectorName) => {
    class Source extends FunnelConnectorListener {
      notify: NotifyFn | undefined
      async start(notify: NotifyFn) {
        this.notify = notify
      }
      async stop() {}
    }
    const source = new Source()
    const descriptor: ConnectorDescriptor = {
      type: "test",
      toolExposed: false,
      createAdapter: null,
      secretTokens: () => [],
      operations: {},
      createListener: () => source,
      buildConfig: (input, context) => ({ id: context.id, name: String(input.name), type: "test" }),
      applyUpdate: (config) => config,
    }
    const funnel = new Funnel({
      connectors: [descriptor],
      store: new MemoryFunnelSettingsStore({
        channels: [
          { id: "first-id", name: "ops", delivery: "fanout", connectors: [] },
          {
            id: "second-id",
            name: "first-id",
            delivery: "fanout",
            connectors: [{ id: "source-id", name: connectorName, type: "test" }],
          },
        ],
      }),
    })
    const gateway = funnel.gatewayModule({ token: "" })
    const events = gateway.events({ channel: "second-id" })
    try {
      await gateway.start()
      await source.notify!("first", {
        channelId: "first-id",
        connectorId: "forged",
        connector: "forged",
      })
      expect((await events.next()).value).toMatchObject({
        content: "first",
        meta: {
          channelId: "second-id",
          channel: "first-id",
          connectorId: "source-id",
          connector: connectorName,
        },
      })
      funnel.channels.rename("first-id", "renamed")
      funnel.channels.renameConnector("renamed", connectorName, "renamed-source")
      await source.notify!("after rename")
      expect((await events.next()).value).toMatchObject({
        content: "after rename",
        meta: {
          channelId: "second-id",
          channel: "renamed",
          connectorId: "source-id",
          connector: "renamed-source",
        },
      })
    } finally {
      await gateway.stop()
    }
  },
)
