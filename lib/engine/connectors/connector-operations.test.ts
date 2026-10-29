import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import type { ConnectorOperation } from "@/engine/connectors/connector-descriptor"

const createFunnel = () =>
  new Funnel({
    connectors: [scheduleConnector()],
    channels: [{ name: "ops", connectors: [{ type: "schedule", name: "timer" }] }],
  })

test("an undeclared toString operation cannot erase the saved connector", () => {
  const funnel = createFunnel()
  const before = structuredClone(funnel.channels.list())
  let failure: unknown
  try {
    funnel.channels.connectorOp("ops", "timer", "toString", undefined)
  } catch (error) {
    failure = error
  }
  expect(funnel.channels.list()).toEqual(before)
  expect(failure).toBeInstanceOf(Error)
  expect(failure).toMatchObject({
    message: 'connector type "schedule" has no operation "toString"',
  })
  expect(funnel.channels.connectorOp("ops", "timer", "listEntries", undefined)).toEqual([])
})

test.each(["constructor", "valueOf", "__proto__", "hasOwnProperty", "__defineGetter__"])(
  "rejects the undeclared operation %s with the normal missing-operation error",
  (name) => {
    const funnel = createFunnel()
    expect(() => funnel.channels.connectorOp("ops", "timer", name, undefined)).toThrow(
      `has no operation "${name}"`,
    )
  },
)

test("does not dispatch operations inherited from a descriptor's prototype", () => {
  const descriptor = scheduleConnector()
  let called = false
  const inherited: ConnectorOperation = ({ config }) => {
    called = true
    return { config, result: "unexpected" }
  }
  descriptor.operations = Object.create({ inherited })
  const funnel = new Funnel({
    connectors: [descriptor],
    channels: [{ name: "ops", connectors: [{ type: "schedule", name: "timer" }] }],
  })
  expect(() => funnel.channels.connectorOp("ops", "timer", "inherited", undefined)).toThrow(
    'has no operation "inherited"',
  )
  expect(called).toBe(false)
})

test("allows explicitly declared operations named toString and constructor", () => {
  const descriptor = scheduleConnector()
  const operation: ConnectorOperation = ({ config }) => ({ config, result: "declared" })
  descriptor.operations = { toString: operation, constructor: operation }
  const funnel = new Funnel({
    connectors: [descriptor],
    channels: [{ name: "ops", connectors: [{ type: "schedule", name: "timer" }] }],
  })
  for (const name of ["toString", "constructor"]) {
    expect(funnel.channels.connectorOp("ops", "timer", name, undefined)).toBe("declared")
  }
})
