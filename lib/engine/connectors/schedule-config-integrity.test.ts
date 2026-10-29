import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { scheduleConnectorSchema } from "@/engine/connectors/schedule-connector-schema"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"

const once = {
  id: "entry",
  kind: "once" as const,
  runAt: "2026-01-01T00:00:00.000Z",
  prompt: "one",
  enabled: true,
  catchupPolicy: "latest" as const,
}
const cron = {
  id: "entry",
  kind: "cron" as const,
  cron: "* * * * *",
  prompt: "two",
  enabled: true,
  catchupPolicy: "latest" as const,
}
const config = { id: "source", name: "timer", type: "schedule" as const, entries: [once, cron] }
const setup = () => new Funnel({ connectors: [scheduleConnector()], channels: [{ name: "ops" }] })

test("duplicate schedule identities are rejected across one-shot and cron configurations", () => {
  for (const entries of [
    [once, once],
    [once, cron],
    [cron, cron],
  ])
    expect(() => scheduleConnectorSchema.parse({ ...config, entries })).toThrow(
      "schedule entry IDs must be unique",
    )
})

test("creating a connector with colliding schedule IDs cannot persist a partially usable configuration", () => {
  const funnel = setup()
  expect(() =>
    funnel.channels.addConnector("ops", {
      type: "schedule",
      name: "timer",
      entries: config.entries,
    }),
  ).toThrow("schedule entry IDs must be unique")
  expect(funnel.channels.listConnectors("ops")).toEqual([])
})

test("restored duplicate schedule IDs fail before constructing a runnable source", () => {
  const store = new MemoryFunnelSettingsStore({
    channels: [
      {
        id: "channel",
        name: "ops",
        delivery: "fanout",
        connectors: [config],
      },
    ],
  })
  const funnel = new Funnel({ store, connectors: [scheduleConnector()] })
  expect(() => funnel.channels.createListener("ops", "timer")).toThrow(
    "schedule entry IDs must be unique",
  )
})

test("direct listener construction also rejects shared checkpoint identities", () => {
  expect(
    () => new FunnelScheduleListener({ config, lastFiredStore: new FunnelScheduleStateStore() }),
  ).toThrow("schedule entry IDs must be unique")
})

test("non-array entry collections are rejected instead of silently creating empty schedules", () => {
  const funnel = setup()
  for (const entries of [null, "invalid", {}, 42, true]) {
    expect(() =>
      funnel.channels.addConnector("ops", { type: "schedule", name: "timer", entries }),
    ).toThrow()
    expect(funnel.channels.listConnectors("ops")).toEqual([])
  }
})

test("omitted and empty entry arrays remain valid and addEntry keeps its existing duplicate error", () => {
  const funnel = setup()
  funnel.channels.addConnector("ops", { type: "schedule", name: "omitted" })
  funnel.channels.addConnector("ops", { type: "schedule", name: "empty", entries: [] })
  const input = { id: "entry", runAt: once.runAt, prompt: "one" }
  funnel.channels.connectorOp("ops", "omitted", "addEntry", input)
  const before = JSON.stringify(funnel.channels.getConnector("ops", "omitted"))
  expect(() => funnel.channels.connectorOp("ops", "omitted", "addEntry", input)).toThrow(
    'schedule entry "entry" already exists',
  )
  expect(JSON.stringify(funnel.channels.getConnector("ops", "omitted"))).toBe(before)
})
