import type { ConnectorConnectionRecord } from "@/engine/diagnostic-log/diagnostic-log"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"
import { expect, test } from "bun:test"
import { FunnelScheduleListener } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import type { ScheduleEntry } from "@/engine/connectors/schedule-connector-schema"

for (const kind of ["once", "cron"] as const) {
  test(`an invalid schedule clock cannot fire or checkpoint a ${kind} entry`, async () => {
    const state = new FunnelScheduleStateStore()
    let now = new Date(NaN)
    const entry: ScheduleEntry =
      kind === "once"
        ? {
            id: "entry",
            kind,
            runAt: "2026-01-02T00:00:00.000Z",
            prompt: "entry",
            enabled: true,
            catchupPolicy: "latest",
          }
        : {
            id: "entry",
            kind,
            cron: "* * * * *",
            prompt: "entry",
            enabled: true,
            catchupPolicy: "latest",
          }
    const listener = new FunnelScheduleListener({
      config: { id: "source", name: "source", type: "schedule", entries: [entry] },
      lastFiredStore: state,
      now: () => now,
    })
    const delivered: string[] = []
    const notify = async (content: string) => {
      delivered.push(content)
    }
    try {
      await expect(listener.tick(notify)).rejects.toThrow("time must be a valid timestamp")
      expect(delivered).toEqual([])
      expect([...state.load()]).toEqual([])
      now = new Date("2026-01-02T00:00:00.000Z")
      await listener.tick(notify)
      expect(delivered).toEqual(["entry"])
      expect(state.load().get("entry")?.toISOString()).toBe(now.toISOString())
    } finally {
      await listener.stop()
    }
  })
}

test("an invalid clock cannot arm a zero-delay schedule timer during startup", async () => {
  const listener = new FunnelScheduleListener({
    config: { id: "source", name: "source", type: "schedule", entries: [] },
    lastFiredStore: new FunnelScheduleStateStore(),
    now: () => new Date(NaN),
  })
  try {
    await expect(listener.start(async () => {})).rejects.toThrow("time must be a valid timestamp")
    expect(listener.isAlive()).toBe(false)
  } finally {
    await listener.stop()
  }
})

test("a clock failure after startup disarms the timer and makes the listener recoverable", async () => {
  let now = new Date("2026-01-01T00:00:59.999Z")
  const reported = Promise.withResolvers<void>()
  class Logger extends NoopFunnelLogger {
    override error(): void {
      reported.resolve()
    }
  }
  const listener = new FunnelScheduleListener({
    config: { id: "source", name: "source", type: "schedule", entries: [] },
    lastFiredStore: new FunnelScheduleStateStore(),
    now: () => now,
    logger: new Logger(),
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await listener.start(async () => {})
    now = new Date(NaN)
    await Promise.race([
      reported.promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("clock failure was not reported")), 1000)
      }),
    ])
    expect(listener.isAlive()).toBe(false)
    now = new Date("2026-01-01T00:01:00.000Z")
    await listener.start(async () => {})
    expect(listener.isAlive()).toBe(true)
  } finally {
    clearTimeout(timer)
    await listener.stop()
  }
})

test("a failed schedule error observer cannot hide an invalid clock or leave the listener alive", async () => {
  class Logger extends NoopFunnelLogger {
    override error(): void {
      throw new Error("observer failed")
    }
  }
  const listener = new FunnelScheduleListener({
    config: { id: "source", name: "source", type: "schedule", entries: [] },
    lastFiredStore: new FunnelScheduleStateStore(),
    now: () => new Date(NaN),
    logger: new Logger(),
  })
  try {
    await expect(listener.start(async () => {})).rejects.toThrow("time must be a valid timestamp")
    expect(listener.isAlive()).toBe(false)
  } finally {
    await listener.stop()
  }
})

test("a failed connected observer does not leave an armed timer behind a failed startup", async () => {
  class Diagnostics extends MemoryConnectorDiagnosticLog {
    override recordConnection(input: ConnectorConnectionRecord): void {
      if (input.status === "connected") throw new Error("diagnostic observer failed")
      super.recordConnection(input)
    }
  }
  const diagnostics = new Diagnostics()
  const listener = new FunnelScheduleListener({
    config: { id: "source", name: "source", type: "schedule", entries: [] },
    lastFiredStore: new FunnelScheduleStateStore(),
    now: () => new Date(0),
    diagnosticLog: diagnostics,
  })
  try {
    await listener.start(async () => {})
    expect(listener.isAlive()).toBe(true)
    await listener.stop()
    expect(listener.isAlive()).toBe(false)
  } finally {
    await listener.stop()
  }
})
