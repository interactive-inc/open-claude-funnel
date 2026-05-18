import { describe, expect, test } from "vitest"
import { killCompetingSlackGateways } from "@/gateway/kill-competing-slack-gateways"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"

const HIRACT_DIR = "/Users/me/.funnel"
const INTA_DIR = "/Users/me/.inta/funnel"

const psOutput = [
  `  100 bun /home/me/dist/gateway/daemon.js funnel-gateway[${HIRACT_DIR}]`,
  `  200 bun /home/me/dist/gateway/daemon.js funnel-gateway[${INTA_DIR}]`,
  `  300 bun /home/me/dist/gateway/daemon.js funnel-gateway[${HIRACT_DIR}]`,
  "  400 /usr/local/bin/bun /home/me/other/gateway.ts",
  "  500 /usr/local/bin/bun /home/me/sample/cli/index.ts gateway run",
  "  600 /usr/bin/node /home/me/app/index.js",
].join("\n")

describe("killCompetingSlackGateways", () => {
  test("kills daemons sharing the same dir (excluding self)", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: psOutput }))

    const killed = await killCompetingSlackGateways({
      selfPid: 300,
      dir: HIRACT_DIR,
      process: runner,
    })

    expect(killed).toEqual([100])
    expect(runner.killed.map((k) => k.pid)).toEqual([100])
  })

  test("leaves daemons rooted at a different dir alone", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: psOutput }))

    const killed = await killCompetingSlackGateways({
      selfPid: 300,
      dir: HIRACT_DIR,
      process: runner,
    })

    expect(killed).not.toContain(200)
    expect(runner.killed.map((k) => k.pid)).not.toContain(200)
  })

  test("leaves unrelated bun processes alone (no funnel-gateway title)", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ stdout: psOutput }))

    const killed = await killCompetingSlackGateways({
      selfPid: 300,
      dir: HIRACT_DIR,
      process: runner,
    })

    expect(killed).not.toContain(400)
    expect(killed).not.toContain(500)
    expect(killed).not.toContain(600)
  })

  test("does not kill own PID", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({
      stdout: `  300 bun funnel-gateway[${HIRACT_DIR}]`,
    }))

    const killed = await killCompetingSlackGateways({
      selfPid: 300,
      dir: HIRACT_DIR,
      process: runner,
    })

    expect(killed).toEqual([])
    expect(runner.killed).toEqual([])
  })

  test("does nothing when ps fails", async () => {
    const runner = new MemoryFunnelProcessRunner().on(() => ({ exitCode: 1 }))

    const killed = await killCompetingSlackGateways({
      selfPid: 300,
      dir: HIRACT_DIR,
      process: runner,
    })

    expect(killed).toEqual([])
    expect(runner.killed).toEqual([])
  })
})
