import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import type { ConnectorConnectionRecord } from "@/engine/diagnostic-log/diagnostic-log"
import type { ScheduleEntry } from "@/engine/connectors/schedule-connector-schema"

const entries: ScheduleEntry[] = ["a", "b"].map((id) => ({
  id,
  kind: "once",
  runAt: "2026-01-01T00:00:00.000Z",
  prompt: id,
  enabled: true,
  catchupPolicy: "latest",
}))
const config = { id: "source", name: "source", type: "schedule" as const, entries }
const now = () => new Date("2026-01-01T00:00:00.000Z")

for (const stage of ["raw", "processed"] as const) {
  test(`failed ${stage} diagnostics cannot suppress delivery, checkpoints or onFired callbacks`, async () => {
    class Diagnostics extends MemoryConnectorDiagnosticLog {
      override recordRaw(): void {
        if (stage === "raw") throw new Error("raw unavailable")
      }
      override recordProcessed(): void {
        if (stage === "processed") throw new Error("processed unavailable")
      }
    }
    const state = new FunnelScheduleStateStore()
    const logger = new MemoryFunnelLogger()
    const observed: string[] = []
    const delivered: string[] = []
    const listener = new FunnelScheduleListener({
      config,
      now,
      lastFiredStore: state,
      diagnosticLog: new Diagnostics(),
      logger,
      onFired: (entry) => {
        observed.push(entry.id)
      },
    })
    try {
      await listener.tick(async (content) => {
        delivered.push(content)
      })
      expect(delivered).toEqual(["a", "b"])
      expect(observed).toEqual(["a", "b"])
      expect(logger.entries.map((entry) => entry.meta?.error)).toEqual([
        `${stage} unavailable`,
        `${stage} unavailable`,
      ])
      expect([...state.load().keys()]).toEqual(["a", "b"])
    } finally {
      await listener.stop()
    }
  })
}

test("failed delivery diagnostics preserve the original notification error and retryable state", async () => {
  class Diagnostics extends MemoryConnectorDiagnosticLog {
    override recordProcessed(): void {
      throw new Error("diagnostic failure")
    }
  }
  const state = new FunnelScheduleStateStore()
  const listener = new FunnelScheduleListener({
    config,
    now,
    lastFiredStore: state,
    diagnosticLog: new Diagnostics(),
  })
  const failure = new Error("notification failed")
  try {
    await expect(
      listener.tick(async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
    expect([...state.load()]).toEqual([])
    const delivered: string[] = []
    await listener.tick(async (content) => {
      delivered.push(content)
    })
    expect(delivered).toEqual(["a", "b"])
  } finally {
    await listener.stop()
  }
})

test("an onFired error reporter cannot abort later entries after successful delivery", async () => {
  class Logger extends NoopFunnelLogger {
    override error(): void {
      throw new Error("logger failed")
    }
  }
  const listener = new FunnelScheduleListener({
    config,
    now,
    lastFiredStore: new FunnelScheduleStateStore(),
    logger: new Logger(),
    onFired: () => {
      throw new Error("observer failed")
    },
  })
  const delivered: string[] = []
  try {
    await listener.tick(async (content) => {
      delivered.push(content)
    })
    expect(delivered).toEqual(["a", "b"])
  } finally {
    await listener.stop()
  }
})

test("invalid cron reporting failures do not block unrelated valid entries", async () => {
  class Diagnostics extends MemoryConnectorDiagnosticLog {
    override recordConnection(record: ConnectorConnectionRecord): void {
      if (record.status === "error") throw new Error("diagnostics failed")
      super.recordConnection(record)
    }
  }
  class Logger extends NoopFunnelLogger {
    override error(): void {
      throw new Error("logger failed")
    }
  }
  const listener = new FunnelScheduleListener({
    config: {
      ...config,
      entries: [
        {
          id: "invalid",
          kind: "cron",
          cron: "invalid",
          prompt: "invalid",
          enabled: true,
          catchupPolicy: "skip",
        },
        ...entries,
      ],
    },
    now,
    lastFiredStore: new FunnelScheduleStateStore(),
    diagnosticLog: new Diagnostics(),
    logger: new Logger(),
  })
  const delivered: string[] = []
  try {
    await listener.tick(async (content) => {
      delivered.push(content)
    })
    expect(delivered).toEqual(["a", "b"])
  } finally {
    await listener.stop()
  }
})

test("asynchronous diagnostic and error-reporter rejections cannot become unhandled process errors", async () => {
  const source = `
import { FunnelScheduleListener } from ${JSON.stringify(new URL("./schedule-listener.ts", import.meta.url).href)}
import { FunnelScheduleStateStore } from ${JSON.stringify(new URL("./schedule-state-store.ts", import.meta.url).href)}
import { MemoryConnectorDiagnosticLog } from ${JSON.stringify(new URL("../diagnostic-log/memory-diagnostic-log.ts", import.meta.url).href)}
import { NoopFunnelLogger } from ${JSON.stringify(new URL("../logger/noop-logger.ts", import.meta.url).href)}
const unhandled = []
process.on("unhandledRejection", error => unhandled.push(String(error)))
class Diagnostics extends MemoryConnectorDiagnosticLog {
  recordRaw() { return Promise.reject(new Error("async raw failed")) }
  recordProcessed() { return Promise.reject(new Error("async processed failed")) }
  recordConnection() { return Promise.reject(new Error("async connection failed")) }
}
class Logger extends NoopFunnelLogger {
  error() { return Promise.reject(new Error("async reporter failed")) }
}
const delivered = []
const listener = new FunnelScheduleListener({
  config: ${JSON.stringify(config)}, now: () => new Date("2026-01-01T00:00:00.000Z"),
  lastFiredStore: new FunnelScheduleStateStore(), diagnosticLog: new Diagnostics(), logger: new Logger(),
  onFired() { throw new Error("observer failed") },
})
await listener.start(async content => { delivered.push(content) })
await listener.stop()
await Bun.sleep(20)
console.log(JSON.stringify({ delivered, unhandled }))
`
  const child = Bun.spawn([process.execPath, "-e", source], { stdout: "pipe", stderr: "pipe" })
  const [output, errors, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exit, errors }).toEqual({ exit: 0, errors: "" })
  expect(JSON.parse(output)).toEqual({ delivered: ["a", "b"], unhandled: [] })
})
