import { expect, test } from "bun:test"
import { FunnelConnectorRegistry } from "@/engine/connectors/connector-registry"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import type {
  ConnectorDescriptor,
  ConnectorOperation,
} from "@/engine/connectors/connector-descriptor"

const config = { id: "connector", name: "source", type: "schedule" }
const context = { generateId: () => "generated", now: "2026-01-01T00:00:00.000Z" }

test("operation ownership is checked on the same table used for dispatch", () => {
  let reads = 0
  let inheritedCalls = 0
  const own: ConnectorOperation = ({ config }) => ({ config, result: "own" })
  const inherited: ConnectorOperation = ({ config }) => {
    inheritedCalls++
    return { config, result: "inherited" }
  }
  const descriptor: ConnectorDescriptor = {
    ...scheduleConnector(),
    get operations() {
      return ++reads === 1 ? { run: own } : Object.create({ run: inherited })
    },
  }
  const registry = new FunnelConnectorRegistry({ descriptors: [descriptor] })
  expect(registry.runOperation(config, "run", null, context)).toEqual({ config, result: "own" })
  expect(reads).toBe(1)
  expect(inheritedCalls).toBe(0)
  expect(() => registry.runOperation(config, "run", null, context)).toThrow(
    'has no operation "run"',
  )
  expect(reads).toBe(2)
  expect(inheritedCalls).toBe(0)
})

test("adapter dispatch reads its factory once and preserves the descriptor receiver", () => {
  let reads = 0
  let calls = 0
  const adapter = { call: async () => null }
  const descriptor: ConnectorDescriptor = {
    ...scheduleConnector(),
    get createAdapter() {
      if (++reads > 1) return null
      return function (this: ConnectorDescriptor) {
        expect(this).toBe(descriptor)
        calls++
        return adapter
      }
    },
  }
  const registry = new FunnelConnectorRegistry({ descriptors: [descriptor] })
  expect(registry.createAdapter(config)).toBe(adapter)
  expect(reads).toBe(1)
  expect(calls).toBe(1)
  expect(registry.createAdapter(config)).toBeNull()
  expect(reads).toBe(2)
  expect(calls).toBe(1)
})
