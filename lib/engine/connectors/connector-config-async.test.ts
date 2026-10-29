import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import type {
  ConnectorDescriptor,
  ConnectorOperation,
} from "@/engine/connectors/connector-descriptor"

for (const kind of ["promise", "thenable"] as const) {
  for (const stage of ["buildConfig", "applyUpdate", "operation"] as const) {
    test(`${kind} connector ${stage} is rejected without changing settings or leaking its rejection`, async () => {
      const descriptor = {
        ...scheduleConnector(),
        operations: { ...scheduleConnector().operations },
      }
      const original = { ...descriptor, operations: { ...descriptor.operations } }
      const funnel = new Funnel({
        connectors: [descriptor],
        channels: [{ name: "channel", connectors: [{ name: "source", type: "schedule" }] }],
      })
      const before = funnel.channels.list()
      let observed = 0
      const asynchronous =
        kind === "promise"
          ? async () => {
              await Promise.resolve()
              observed++
              throw new Error("late hook failure")
            }
          : () =>
              // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host-supplied thenable.
              Object.defineProperty({}, "then", {
                value: (_resolve: unknown, reject: (error: unknown) => void) => {
                  observed++
                  reject(new Error("late hook failure"))
                },
              })
      if (stage === "buildConfig")
        descriptor.buildConfig = asynchronous as unknown as ConnectorDescriptor["buildConfig"]
      else if (stage === "applyUpdate")
        descriptor.applyUpdate = asynchronous as unknown as ConnectorDescriptor["applyUpdate"]
      else descriptor.operations.run = asynchronous as unknown as ConnectorOperation
      const run = () => {
        if (stage === "buildConfig")
          return funnel.channels.addConnector("channel", { type: "schedule", name: "next" })
        if (stage === "applyUpdate") return funnel.channels.updateConnector("channel", "source", {})
        return funnel.channels.connectorOp("channel", "source", "run", null)
      }
      try {
        expect(run).toThrow(`connector ${stage} must be synchronous`)
        await Bun.sleep(0)
        expect(observed).toBe(1)
        expect(funnel.channels.list()).toEqual(before)
      } finally {
        Object.assign(descriptor, original)
      }
      expect(() =>
        funnel.channels.addConnector("channel", { type: "schedule", name: "next" }),
      ).not.toThrow()
      expect(funnel.channels.get("channel")?.connectors).toHaveLength(2)
    })
  }
}
