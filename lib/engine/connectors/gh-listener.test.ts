import { describe, expect, test } from "vitest"
import { FunnelGhListener } from "@/engine/connectors/gh-listener"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"

const config = { type: "gh" as const, id: "g-id", name: "g" }

type GhItem = {
  id: string
  reason: string
  subject: { type: string; url: string; title: string }
  repository: { full_name: string }
  updated_at: string
}

const item = (id: string, updated_at: string): GhItem => ({
  id,
  reason: "mention",
  subject: { type: "Issue", url: "https://api.github.com/repos/x/1", title: "t" },
  repository: { full_name: "x/y" },
  updated_at,
})

describe("FunnelGhListener", () => {
  test("first pollOnce only seeds state and does not notify", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({
      stdout: JSON.stringify([item("1", "t1")]),
    }))
    const listener = new FunnelGhListener({ config, process: runner })
    const sent: { content: string; meta?: Record<string, string> }[] = []

    await listener.pollOnce(async (content, meta) => {
      sent.push({ content, meta })
    })

    expect(sent).toHaveLength(0)
    expect(runner.calls[0]?.command[0]).toBe("gh")
  })

  test("subsequent polls notify on new items and updated_at changes", async () => {
    let stdout = JSON.stringify([item("1", "t1")])
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout }))
    const listener = new FunnelGhListener({ config, process: runner })
    const sent: { meta?: Record<string, string> }[] = []

    const notify = async (_c: string, m?: Record<string, string>) => {
      sent.push({ meta: m })
    }

    await listener.pollOnce(notify)
    expect(sent).toHaveLength(0)

    // add new id "2"
    stdout = JSON.stringify([item("1", "t1"), item("2", "t2")])
    await listener.pollOnce(notify)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.meta?.thread_id).toBe("2")

    // updated_at for id "1" changed
    stdout = JSON.stringify([item("1", "t1b"), item("2", "t2")])
    await listener.pollOnce(notify)
    expect(sent).toHaveLength(2)
    expect(sent[1]?.meta?.thread_id).toBe("1")
    expect(sent[1]?.meta?.updated_at).toBe("t1b")
  })

  test("non-zero exitCode is treated as an error and does not notify", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({
      exitCode: 1,
      stderr: "auth",
    }))
    const listener = new FunnelGhListener({ config, process: runner })
    const sent: unknown[] = []

    await listener.pollOnce(async () => {
      sent.push(1)
    })

    expect(sent).toEqual([])
  })

  test("isAlive flips with start / stop", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: "[]" }))
    const listener = new FunnelGhListener({
      config: { ...config, pollInterval: 3600 },
      process: runner,
    })

    expect(listener.isAlive()).toBe(false)

    await listener.start(async () => {})
    expect(listener.isAlive()).toBe(true)

    await listener.stop()
    expect(listener.isAlive()).toBe(false)
  })
})

describe("FunnelGhListener: diagnostic log", () => {
  test("first poll records raw + skip:bootstrap; a later poll records raw + emitted", async () => {
    let stdout = JSON.stringify([item("1", "t1")])
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout }))
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelGhListener({
      config,
      channelId: "ch-uuid-1",
      process: runner,
      diagnosticLog,
    })

    // First poll is the bootstrap backlog: captured raw, deliberately not emitted.
    await listener.pollOnce(async () => {})

    const bootstrapRaws = diagnosticLog.queryRaw({})
    expect(bootstrapRaws).toHaveLength(1)
    expect(bootstrapRaws[0]?.type).toBe("gh")
    expect(bootstrapRaws[0]?.connectorId).toBe("g-id")
    expect(bootstrapRaws[0]?.channelId).toBe("ch-uuid-1")
    expect(bootstrapRaws[0]?.eventId).toBe("1")

    const bootstrapProcessed = diagnosticLog.queryProcessed({})
    expect(bootstrapProcessed).toHaveLength(1)
    expect(bootstrapProcessed[0]?.outcome).toBe("skip:bootstrap")
    expect(bootstrapProcessed[0]?.eventId).toBe("1")

    // Second poll, now bootstrapped: the same id with a new updated_at emits.
    stdout = JSON.stringify([item("1", "t1b")])
    await listener.pollOnce(async () => {})

    // The new revision is a fresh raw row plus an emitted verdict (eventId "1").
    expect(diagnosticLog.queryRaw({})).toHaveLength(2)
    const emitted = diagnosticLog.queryProcessed({ outcome: "emitted" })
    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.eventId).toBe("1")
  })

  test("a clean first poll records started then connected", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: "[]" }))
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelGhListener({ config, process: runner, diagnosticLog })

    await listener.pollOnce(async () => {})

    const statuses = diagnosticLog.queryConnection({}).map((row) => row.status)
    expect(statuses).toContain("connected")
  })

  test("records started + connected over a full start()", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: "[]" }))
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelGhListener({
      config: { ...config, pollInterval: 3600 },
      process: runner,
      diagnosticLog,
    })

    await listener.start(async () => {})
    await listener.stop()

    const statuses = diagnosticLog.queryConnection({}).map((row) => row.status)
    expect(statuses).toContain("started")
    expect(statuses).toContain("connected")
    expect(statuses).toContain("stopped")
  })

  test("a non-zero gh api exit records an error connection row", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ exitCode: 1, stderr: "auth" }))
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelGhListener({ config, process: runner, diagnosticLog })

    await listener.pollOnce(async () => {})

    const errors = diagnosticLog.queryConnection({ status: "error" })
    expect(errors).toHaveLength(1)
    expect(errors[0]?.detail).toContain("gh api exited 1")
    // A failed poll never reaches the "connected" milestone.
    expect(diagnosticLog.queryConnection({ status: "connected" })).toHaveLength(0)
  })

  test("records nothing and does not throw when no diagnosticLog is injected", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({
      stdout: JSON.stringify([item("1", "t1")]),
    }))
    const listener = new FunnelGhListener({ config, process: runner })

    // Exercising the record paths; absence of a throw is the assertion.
    await listener.pollOnce(async () => {})
  })
})
