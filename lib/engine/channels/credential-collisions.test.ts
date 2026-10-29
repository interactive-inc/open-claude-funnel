import { expect, test } from "bun:test"
import { FunnelChannels } from "@/engine/channels/channels"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { slackConnector } from "@/engine/connectors/slack-connector"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"

const connector = (suffix: string) => ({
  id: "shared",
  type: "slack",
  name: "source",
  botToken: `xoxb-${suffix}`,
  appToken: `xapp-${suffix}`,
  minify: true,
})

const setup = (withSecond: boolean) => {
  const store = new MemoryFunnelSettingsStore({
    channels: [
      { id: "first", name: "first", delivery: "fanout", connectors: [connector("first")] },
      {
        id: "second",
        name: "second",
        delivery: "fanout",
        connectors: withSecond ? [connector("second")] : [],
      },
    ],
  })
  const channels = new FunnelChannels({
    store,
    registry: new FunnelConnectorRegistry({ descriptors: [slackConnector()] }),
    idGenerator: { generate: () => "shared" },
  })
  return { store, channels }
}

test("a new connector cannot reuse another channel's credentials when IDs match", () => {
  const { store, channels } = setup(false)
  const before = store.read()
  expect(() =>
    channels.addConnector("second", {
      type: "slack",
      name: "source",
      botToken: "xoxb-first",
      appToken: "xapp-second",
    }),
  ).toThrow("token already in use")
  expect(store.read()).toEqual(before)
})

test("an update checks other channels even when they share the same connector ID", () => {
  const { store, channels } = setup(true)
  const before = store.read()
  expect(() => channels.updateConnector("second", "source", { botToken: "xoxb-first" })).toThrow(
    "token already in use",
  )
  expect(store.read()).toEqual(before)
})

test("only the actual connector being replaced is excluded from credential checks", () => {
  const { channels } = setup(true)
  channels.updateConnector("second", "source", { minify: false, botToken: "xoxb-second" })
  expect(channels.getConnector("second", "source")).toMatchObject({
    minify: false,
    botToken: "xoxb-second",
  })
  expect(channels.getConnector("first", "source")).toMatchObject({
    minify: true,
    botToken: "xoxb-first",
  })
})
