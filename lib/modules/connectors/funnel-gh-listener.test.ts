import { describe, expect, test } from "bun:test"
import { FunnelGhListener } from "@/modules/connectors/funnel-gh-listener"
import { MemoryFunnelProcessRunner } from "@/modules/process/memory-funnel-process-runner"

const config = { type: "gh" as const, name: "g" }

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
})
