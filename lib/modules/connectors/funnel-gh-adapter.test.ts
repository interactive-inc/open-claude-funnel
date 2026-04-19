import { describe, expect, test } from "bun:test"
import { FunnelGhAdapter } from "@/modules/connectors/funnel-gh-adapter"
import { MemoryFunnelProcessRunner } from "@/modules/process/memory-funnel-process-runner"

describe("FunnelGhAdapter", () => {
  test("calls gh api with correct args (GET)", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: '{"ok":true}' }))
    const adapter = new FunnelGhAdapter({ process: runner })

    const result = await adapter.call({ method: "get", path: "/notifications" })

    expect(result).toEqual({ ok: true })
    expect(runner.calls[0]?.command).toEqual(["gh", "api", "/notifications"])
  })

  test("POST adds -X POST and pipes body to stdin", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: '{"ok":true}' }))
    const adapter = new FunnelGhAdapter({ process: runner })

    await adapter.call({ method: "post", path: "/repos/owner/repo/issues", body: { title: "x" } })

    const call = runner.calls[0]
    expect(call?.command).toEqual([
      "gh",
      "api",
      "/repos/owner/repo/issues",
      "-X",
      "POST",
      "--input",
      "-",
    ])
    expect((call?.options as { input?: string }).input).toBe('{"title":"x"}')
  })

  test("non-zero exitCode throws Error", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({
      exitCode: 1,
      stderr: "auth required",
    }))
    const adapter = new FunnelGhAdapter({ process: runner })

    expect(adapter.call({ method: "get", path: "/" })).rejects.toThrow(/auth required/)
  })

  test("non-JSON stdout is returned as a plain string", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: "hello" }))
    const adapter = new FunnelGhAdapter({ process: runner })

    expect(await adapter.call({ method: "get", path: "/" })).toBe("hello")
  })
})
