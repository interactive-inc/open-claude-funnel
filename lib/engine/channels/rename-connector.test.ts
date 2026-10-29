import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

const createFunnel = () => {
  const clock = new MemoryFunnelClock({ start: new Date("2026-01-01T00:00:00.000Z") })
  const funnel = new Funnel({
    clock,
    connectors: [scheduleConnector()],
    channels: [{ name: "ops", connectors: [{ type: "schedule", name: "timer" }] }],
  })
  return { clock, funnel }
}

test("a failed timestamp cannot partially rename a saved connector", () => {
  const { clock, funnel } = createFunnel()
  const before = structuredClone(funnel.channels.list())
  clock.set(new Date(NaN))
  expect(() => funnel.channels.renameConnector("ops", "timer", "new-name")).toThrow(RangeError)
  expect(funnel.channels.list()).toEqual(before)
  expect(funnel.channels.getConnector("ops", "timer")).not.toBeNull()
  expect(funnel.channels.getConnector("ops", "new-name")).toBeNull()

  clock.set(new Date("2026-01-01T00:01:00.000Z"))
  funnel.channels.renameConnector("ops", "timer", "new-name")
  expect(funnel.channels.getConnector("ops", "new-name")).toMatchObject({
    id: before[0]!.connectors[0]!.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:01:00.000Z",
  })
})
