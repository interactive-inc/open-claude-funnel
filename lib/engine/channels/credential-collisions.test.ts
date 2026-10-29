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
  let outcomeReads = 0
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
    registry: new FunnelConnectorRegistry({
      descriptors: [
        {
          ...slackConnector(),
          operations: {
            rotateToken: ({ config, args }) => ({
              config: { ...config, botToken: args },
              result: "updated",
            }),
            mutateToken: ({ config, args }) => ({
              config: Object.assign(config, { botToken: args }),
              result: "updated",
            }),
            inspect: ({ config }) => ({ config, result: "read" }),
            changingConfig: ({ config, args }) => ({
              get config() {
                outcomeReads++
                return outcomeReads === 1
                  ? { ...config, minify: false }
                  : { ...config, botToken: args }
              },
              result: "updated",
            }),
            resultChangesConfig: ({ config, args }) => {
              const next = { ...config, botToken: "xoxb-third" }
              return {
                config: next,
                get result() {
                  next.botToken = String(args)
                  return "updated"
                },
              }
            },
          },
        },
      ],
    }),
    idGenerator: { generate: () => "shared" },
  })
  return { store, channels, outcomeReads: () => outcomeReads }
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

for (const operation of ["rotateToken", "mutateToken"]) {
  test(`${operation} cannot bypass cross-channel credential collision checks`, () => {
    const { store, channels } = setup(true)
    const before = store.read()
    expect(() => channels.connectorOp("second", "source", operation, "xoxb-first")).toThrow(
      "token already in use",
    )
    expect(store.read()).toEqual(before)
  })
}

test("a valid credential operation returns its result and persists the new credential", () => {
  const { channels } = setup(true)
  expect(channels.connectorOp("second", "source", "rotateToken", "xoxb-third")).toBe("updated")
  expect(channels.getConnector("second", "source")).toMatchObject({ botToken: "xoxb-third" })
  expect(channels.connectorOp("second", "source", "inspect", undefined)).toBe("read")
})

test("operation results persist the same config that passed credential checks", () => {
  const { channels, outcomeReads } = setup(true)
  expect(channels.connectorOp("second", "source", "changingConfig", "xoxb-first")).toBe("updated")
  expect(channels.getConnector("second", "source")).toMatchObject({
    botToken: "xoxb-second",
    minify: false,
  })
  expect(outcomeReads()).toBe(1)
})

test("reading an operation result cannot change credentials after collision checks", () => {
  const { channels, store } = setup(true)
  const before = store.read()
  expect(() =>
    channels.connectorOp("second", "source", "resultChangesConfig", "xoxb-first"),
  ).toThrow("token already in use")
  expect(store.read()).toEqual(before)
})
