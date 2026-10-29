import { Funnel } from "@/funnel"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import type { ConnectorConnectionRecord } from "@/engine/diagnostic-log/diagnostic-log"
import { expect, test } from "bun:test"
import { FunnelScheduleListener, type ScheduleOnFired } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

const setup = (onFired?: ScheduleOnFired) => {
  const state = new FunnelScheduleStateStore()
  const connected = Promise.withResolvers<void>()
  class Diagnostics extends MemoryConnectorDiagnosticLog {
    override recordConnection(input: ConnectorConnectionRecord): void {
      super.recordConnection(input)
      if (input.status === "connected") connected.resolve()
    }
  }
  const diagnostics = new Diagnostics()
  const listener = new FunnelScheduleListener({
    config: {
      id: "source",
      name: "source",
      type: "schedule",
      entries: ["a", "b"].map((id) => ({
        id,
        kind: "once" as const,
        runAt: "2026-01-01T00:00:00.000Z",
        prompt: id,
        enabled: true,
        catchupPolicy: "latest" as const,
      })),
    },
    onFired,
    lastFiredStore: state,
    diagnosticLog: diagnostics,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  })
  return { listener, state, diagnostics, connected: connected.promise }
}

test("duplicate starts cannot replace an active schedule run", async () => {
  const { listener } = setup()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const starting = listener.start(async () => {
    entered.resolve()
    await release.promise
  })
  try {
    await entered.promise
    await expect(listener.start(async () => {})).rejects.toThrow("already started")
    release.resolve()
    await starting
    await expect(listener.start(async () => {})).rejects.toThrow("already started")
  } finally {
    release.resolve()
    await starting
    await listener.stop()
  }
})

test("a stopped run cannot resume delivery or arm a second timer after restart", async () => {
  const { listener, state, diagnostics, connected } = setup()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const resumed = Promise.withResolvers<void>()
  const old: string[] = []
  const current: string[] = []
  const starting = listener.start(async (content) => {
    old.push(content)
    entered.resolve()
    await release.promise
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await entered.promise
    await listener.stop()
    await listener.start(async (content) => {
      current.push(content)
      resumed.resolve()
    })
    release.resolve()
    await starting
    await Promise.race([
      Promise.all([resumed.promise, connected]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("new run never resumed after old notification")),
          1000,
        )
      }),
    ])
    expect(old).toEqual(["a"])
    expect(current).toEqual(["b"])
    expect([...state.load().keys()]).toEqual(["a", "b"])
    expect(diagnostics.queryConnection({ status: "connected" })).toHaveLength(1)
  } finally {
    clearTimeout(timer)
    release.resolve()
    await starting
    await listener.stop()
  }
})

test("a cancelled startup signal does not deliver or arm a schedule timer", async () => {
  const { listener } = setup()
  const delivered: string[] = []
  try {
    await expect(
      listener.start(async (content) => {
        delivered.push(content)
      }, AbortSignal.abort()),
    ).rejects.toThrow()
    expect(delivered).toEqual([])
    expect(listener.isAlive()).toBe(false)
  } finally {
    await listener.stop()
  }
})

test("startup cancellation during notification prevents later entries and retains the successful checkpoint", async () => {
  const { listener, state } = setup()
  const controller = new AbortController()
  const delivered: string[] = []
  try {
    await expect(
      listener.start(async (content) => {
        delivered.push(content)
        controller.abort()
      }, controller.signal),
    ).rejects.toThrow()
    expect(delivered).toEqual(["a"])
    expect([...state.load().keys()]).toEqual(["a"])
    expect(listener.isAlive()).toBe(false)
  } finally {
    await listener.stop()
  }
})

test("stop and restart from onFired do not deadlock or resume the old callback", async () => {
  let listener: FunnelScheduleListener
  const old: string[] = []
  const current: string[] = []
  const group = setup(async (entry) => {
    if (entry.id !== "a") return
    await listener.stop()
    await listener.start(async (content) => {
      current.push(content)
    })
  })
  listener = group.listener
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      listener.start(async (content) => {
        old.push(content)
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("restart deadlocked")), 1000)
      }),
    ])
    await group.connected
    expect(old).toEqual(["a"])
    expect(current).toEqual(["b"])
    expect([...group.state.load().keys()]).toEqual(["a", "b"])
  } finally {
    clearTimeout(timer)
    await listener.stop()
  }
})

test("stopping a queued restart prevents it from opening after an old notification finishes", async () => {
  const { listener, diagnostics } = setup()
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const current: string[] = []
  const starting = listener.start(async () => {
    entered.resolve()
    await release.promise
  })
  try {
    await entered.promise
    await listener.stop()
    await listener.start(async (content) => {
      current.push(content)
    })
    await listener.stop()
    release.resolve()
    await starting
    await Bun.sleep(0)
    expect(current).toEqual([])
    expect(listener.isAlive()).toBe(false)
    expect(diagnostics.queryConnection({ status: "connected" })).toEqual([])
  } finally {
    release.resolve()
    await starting
    await listener.stop()
  }
})

test("a descriptor-created schedule listener follows the host cancellation signal", async () => {
  const controller = new AbortController()
  const funnel = new Funnel({
    signal: controller.signal,
    connectors: [scheduleConnector()],
    channels: [{ name: "ops", connectors: [{ name: "timer", type: "schedule" }] }],
  })
  const listener = funnel.channels.createListener("ops", "timer")!.listener
  try {
    await listener.start(async () => {})
    expect(listener.isAlive()).toBe(true)
    controller.abort()
    expect(listener.isAlive()).toBe(false)
  } finally {
    await listener.stop()
  }
})

test("a restarted catch-up run delivers remaining minutes only through the new notification", async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const completed = Promise.withResolvers<void>()
  const state = new FunnelScheduleStateStore()
  const listener = new FunnelScheduleListener({
    config: {
      id: "source",
      name: "source",
      type: "schedule",
      entries: [
        {
          id: "entry",
          kind: "cron",
          cron: "* * * * *",
          prompt: "entry",
          enabled: true,
          catchupPolicy: "all",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    },
    lastFiredStore: state,
    now: () => new Date("2026-01-01T00:02:00.000Z"),
    onFired(_entry, firedAt) {
      if (firedAt.getUTCMinutes() === 2) completed.resolve()
    },
  })
  const old: string[] = []
  const current: string[] = []
  const starting = listener.start(async (_content, meta) => {
    old.push(meta!.fired_at!)
    entered.resolve()
    await release.promise
  })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await entered.promise
    await listener.stop()
    await listener.start(async (_content, meta) => {
      current.push(meta!.fired_at!)
    })
    release.resolve()
    await Promise.race([
      Promise.all([starting, completed.promise]),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("catch-up did not resume")), 1000)
      }),
    ])
    expect(old).toEqual(["2026-01-01T00:00:00.000Z"])
    expect(current).toEqual(["2026-01-01T00:01:00.000Z", "2026-01-01T00:02:00.000Z"])
    expect(state.load().get("entry")?.toISOString()).toBe("2026-01-01T00:02:00.000Z")
  } finally {
    clearTimeout(timer)
    release.resolve()
    await starting
    await listener.stop()
  }
})
