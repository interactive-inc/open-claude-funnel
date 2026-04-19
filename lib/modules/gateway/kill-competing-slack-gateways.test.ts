import { describe, expect, test } from "bun:test"
import { killCompetingSlackGateways } from "@/modules/gateway/kill-competing-slack-gateways"
import { MemoryFunnelProcessRunner } from "@/modules/process/memory-funnel-process-runner"

const psOutput = [
  "  100 /usr/local/bin/bun /home/me/other/gateway.ts",
  "  200 /usr/local/bin/bun /home/me/sample/cli/index.ts gateway run",
  "  300 /usr/local/bin/bun /home/me/open-claude-funnel/lib/modules/gateway/daemon.ts",
  "  400 /usr/bin/node /home/me/app/index.js",
  "  500 /bin/bash -c foo",
  "  600 /usr/local/bin/bun /home/me/other/random.ts",
].join("\n")

describe("killCompetingSlackGateways", () => {
  test("kills bun + gateway/slack processes except own PID", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: psOutput }))

    const killed = await killCompetingSlackGateways({ selfPid: 300, process: runner })

    expect(killed.sort()).toEqual([100, 200])
    expect(runner.killed.map((k) => k.pid).sort()).toEqual([100, 200])
  })

  test("does not kill own PID", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({
      stdout: "  300 bun gateway daemon",
    }))

    const killed = await killCompetingSlackGateways({ selfPid: 300, process: runner })

    expect(killed).toEqual([])
    expect(runner.killed).toEqual([])
  })

  test("ignores non-bun processes", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({
      stdout: "  900 /usr/bin/node gateway",
    }))

    const killed = await killCompetingSlackGateways({ selfPid: 300, process: runner })

    expect(killed).toEqual([])
  })

  test("ignores processes whose args miss the keyword", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({
      stdout: "  999 /usr/local/bin/bun /home/me/hello.ts",
    }))

    const killed = await killCompetingSlackGateways({ selfPid: 300, process: runner })

    expect(killed).toEqual([])
  })

  test("does nothing when ps fails", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ exitCode: 1 }))

    const killed = await killCompetingSlackGateways({ selfPid: 300, process: runner })

    expect(killed).toEqual([])
    expect(runner.killed).toEqual([])
  })
})
