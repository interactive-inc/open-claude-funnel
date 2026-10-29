import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import type {
  ConnectorDescriptor,
  ConnectorOperation,
} from "@/engine/connectors/connector-descriptor"

for (const kind of ["promise", "thenable", "changing-then", "nested-thenable"] as const) {
  for (const stage of [
    "buildConfig",
    "applyUpdate",
    "operation",
    "createListener",
    "createAdapter",
    "secretTokens",
  ] as const) {
    test(`${kind} connector ${stage} is rejected without changing settings or leaking its rejection`, async () => {
      const descriptor: ConnectorDescriptor = {
        ...scheduleConnector(),
        operations: { ...scheduleConnector().operations },
        createAdapter: () => ({ call: async () => "ok" }),
      }
      const original = { ...descriptor, operations: { ...descriptor.operations } }
      const funnel = new Funnel({
        connectors: [descriptor],
        channels: [{ name: "channel", connectors: [{ name: "source", type: "schedule" }] }],
      })
      const before = funnel.channels.list()
      let observed = 0
      let thenReads = 0
      const asynchronous =
        kind === "promise" || kind === "changing-then"
          ? () => {
              const value = (async () => {
                await Promise.resolve()
                observed++
                throw new Error("late hook failure")
              })()
              if (kind === "changing-then") {
                const then = value.then
                // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
                Object.defineProperty(value, "then", {
                  get() {
                    return ++thenReads === 1 ? then : undefined
                  },
                })
              }
              return value
            }
          : () =>
              // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
              Object.defineProperty({}, "then", {
                value: (resolve: (value: unknown) => void, reject: (error: unknown) => void) => {
                  observed++
                  const failure = new Error("late hook failure")
                  if (kind === "nested-thenable") resolve(Promise.reject(failure))
                  else reject(failure)
                },
              })
      if (stage === "buildConfig")
        descriptor.buildConfig = asynchronous as unknown as ConnectorDescriptor["buildConfig"]
      else if (stage === "applyUpdate")
        descriptor.applyUpdate = asynchronous as unknown as ConnectorDescriptor["applyUpdate"]
      else if (stage === "operation")
        descriptor.operations.run = asynchronous as unknown as ConnectorOperation
      else if (stage === "createListener")
        descriptor.createListener = asynchronous as unknown as ConnectorDescriptor["createListener"]
      else if (stage === "createAdapter")
        descriptor.createAdapter = asynchronous as unknown as ConnectorDescriptor["createAdapter"]
      else descriptor.secretTokens = asynchronous as unknown as ConnectorDescriptor["secretTokens"]
      const run = () => {
        if (stage === "buildConfig")
          return funnel.channels.addConnector("channel", { type: "schedule", name: "next" })
        if (stage === "applyUpdate") return funnel.channels.updateConnector("channel", "source", {})
        if (stage === "operation")
          return funnel.channels.connectorOp("channel", "source", "run", null)
        if (stage === "createListener") return funnel.channels.createListener("channel", "source")
        if (stage === "createAdapter")
          return funnel.channels.call("channel", "source", { method: "POST", path: "action" })
        return funnel.channels.addConnector("channel", { type: "schedule", name: "next" })
      }
      try {
        if (stage === "createAdapter")
          await expect(run()).rejects.toThrow(`connector ${stage} must be synchronous`)
        else expect(run).toThrow(`connector ${stage} must be synchronous`)
        await Bun.sleep(0)
        expect(observed).toBe(1)
        if (kind === "changing-then") expect(thenReads).toBe(1)
        expect(funnel.channels.list()).toEqual(before)
      } finally {
        Object.assign(descriptor, original)
      }
      expect(() =>
        funnel.channels.addConnector("channel", { type: "schedule", name: "next" }),
      ).not.toThrow()
      expect(funnel.channels.get("channel")?.connectors).toHaveLength(2)
      expect(
        await funnel.channels.call("channel", "source", { method: "POST", path: "action" }),
      ).toBe("ok")
    })
  }
}
