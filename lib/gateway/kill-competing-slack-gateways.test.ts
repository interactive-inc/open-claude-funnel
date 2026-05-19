import { describe, expect, test } from "vitest"
import { killCompetingSlackGateways } from "@/gateway/kill-competing-slack-gateways"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"

const HIRACT_DIR = "/Users/me/.funnel"
const INTA_DIR = "/Users/me/.inta/funnel"

const snapshotsFor = (
  dir: string,
): { pid: number; command: string }[] => [
  { pid: 100, command: `bun /home/me/dist/gateway/daemon.js funnel-gateway[${HIRACT_DIR}]` },
  { pid: 300, command: `bun /home/me/dist/gateway/daemon.js funnel-gateway[${HIRACT_DIR}]` },
].filter((snap) => snap.command.includes(`funnel-gateway[${dir}]`))

describe("killCompetingSlackGateways", () => {
  test("kills daemons sharing the same dir (excluding self)", async () => {
    const runner = new MemoryFunnelProcessRunner().onListProcessesContaining(() =>
      snapshotsFor(HIRACT_DIR),
    )

    const killed = await killCompetingSlackGateways({
      selfPid: 300,
      dir: HIRACT_DIR,
      process: runner,
    })

    expect(killed).toEqual([100])
    expect(runner.killed.map((k) => k.pid)).toEqual([100])
  })

  test("filters by marker so a different dir's daemons are never returned", async () => {
    const runner = new MemoryFunnelProcessRunner().onListProcessesContaining((marker) => {
      if (marker === `funnel-gateway[${INTA_DIR}]`) {
        return [
          {
            pid: 200,
            command: `bun /home/me/dist/gateway/daemon.js funnel-gateway[${INTA_DIR}]`,
          },
        ]
      }
      return snapshotsFor(HIRACT_DIR)
    })

    const killed = await killCompetingSlackGateways({
      selfPid: 300,
      dir: HIRACT_DIR,
      process: runner,
    })

    expect(killed).not.toContain(200)
    expect(runner.killed.map((k) => k.pid)).not.toContain(200)
  })

  test("does not kill own PID", async () => {
    const runner = new MemoryFunnelProcessRunner().onListProcessesContaining(() => [
      { pid: 300, command: `bun funnel-gateway[${HIRACT_DIR}]` },
    ])

    const killed = await killCompetingSlackGateways({
      selfPid: 300,
      dir: HIRACT_DIR,
      process: runner,
    })

    expect(killed).toEqual([])
    expect(runner.killed).toEqual([])
  })

  test("does nothing when the lookup is empty", async () => {
    const runner = new MemoryFunnelProcessRunner().onListProcessesContaining(() => [])

    const killed = await killCompetingSlackGateways({
      selfPid: 300,
      dir: HIRACT_DIR,
      process: runner,
    })

    expect(killed).toEqual([])
    expect(runner.killed).toEqual([])
  })
})
