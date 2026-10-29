import { expect, test } from "bun:test"
import { SqliteConnectorDiagnosticLog } from "@/engine/diagnostic-log/sqlite-diagnostic-log"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"

for (const property of ["then", "catch"] as const) {
  test(`diagnostic write failure contains logger promises with hidden ${property}`, async () => {
    const calls: { message: string; table: unknown; error: unknown }[] = []
    const pending: { reject: (error: unknown) => void }[] = []
    class Logger extends NoopFunnelLogger {
      override error(message = "", meta?: Record<string, unknown>) {
        calls.push({ message, table: meta?.table, error: meta?.error })
        const deferred = Promise.withResolvers<void>()
        pending.push(deferred)
        // oxlint-disable-next-line unicorn/no-thenable -- Exercise a host logger's overridden promise method.
        return Object.defineProperty(deferred.promise, property, { value: undefined })
      }
    }
    const log = new SqliteConnectorDiagnosticLog({
      rawPath: ":memory:",
      processedPath: ":memory:",
      connectionPath: ":memory:",
      logger: new Logger(),
    })
    log.close()
    const ref = { type: "source", connectorId: "connector", channelId: "channel" }
    expect(() => {
      log.recordRaw({ ...ref, eventId: "event", payload: "{}" })
      log.recordProcessed({ ...ref, eventId: "event", payload: "{}", outcome: "emitted" })
      log.recordConnection({ ...ref, status: "error", detail: "input" })
    }).not.toThrow()
    expect(calls.map((call) => call.table)).toEqual(["raw", "processed", "connection"])
    expect(
      calls.every(
        (call) => call.message === "diagnostic log insert failed" && typeof call.error === "string",
      ),
    ).toBe(true)
    expect(pending).toHaveLength(3)
    for (const deferred of pending) deferred.reject(new Error("logger rejected"))
    await Bun.sleep(0)
    expect(calls).toHaveLength(3)
  })
}
