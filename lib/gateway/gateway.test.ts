import { describe, expect, test } from "vitest"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelGateway } from "@/gateway/gateway"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

const PID_FILE = `${process.env.HOME}/.funnel/gateway.pid`

describe("FunnelGateway", () => {
  test("macOS default wraps with caffeinate -i", () => {
    const command = new FunnelGateway().buildStartCommand("/path/to/daemon.ts")

    if (process.platform === "darwin") expect(command).toContain("caffeinate -i")

    expect(command).toContain("nohup")
    expect(command).toContain("/path/to/daemon.ts")
  })

  test("caffeinate=false (like --no-caffeine) omits caffeinate", () => {
    const command = new FunnelGateway().buildStartCommand("/x", { caffeinate: false })

    expect(command).not.toContain("caffeinate")
    expect(command).toContain("nohup")
  })

  test("appends funnel-gateway[<dir>] tag so ps args can scope kill-competing", () => {
    const command = new FunnelGateway({ dir: "/tmp/sandbox/.funnel" }).buildStartCommand("/x", {
      caffeinate: false,
    })

    expect(command).toContain("funnel-gateway[/tmp/sandbox/.funnel]")
  })

  test("isRunning is false when PID file is missing", () => {
    const gateway = new FunnelGateway({
      fs: new MemoryFunnelFileSystem(),
      process: new MemoryFunnelProcessRunner(),
    })

    expect(gateway.isRunning()).toBe(false)
  })

  test("PID exists but ps reports dead → false", () => {
    const fs = new MemoryFunnelFileSystem({ files: { [PID_FILE]: "12345" } })
    const runner = new MemoryFunnelProcessRunner().onSync(() => ({
      exitCode: 1,
      stdout: "",
      stderr: "",
    }))

    expect(new FunnelGateway({ fs, process: runner }).isRunning()).toBe(false)
  })

  test("PID exists and process is alive → true", () => {
    const fs = new MemoryFunnelFileSystem({ files: { [PID_FILE]: "12345" } })
    const runner = new MemoryFunnelProcessRunner().onSync(() => ({
      exitCode: 0,
      stdout: "R\n",
      stderr: "",
    }))

    expect(new FunnelGateway({ fs, process: runner }).isRunning()).toBe(true)
  })

  test("Zombie (Z) counts as dead", () => {
    const fs = new MemoryFunnelFileSystem({ files: { [PID_FILE]: "12345" } })
    const runner = new MemoryFunnelProcessRunner().onSync(() => ({
      exitCode: 0,
      stdout: "Z\n",
      stderr: "",
    }))

    expect(new FunnelGateway({ fs, process: runner }).isRunning()).toBe(false)
  })

  test("start invokes bash -c via detach", async () => {
    const fs = new MemoryFunnelFileSystem()
    const runner = new MemoryFunnelProcessRunner().onSync(() => ({
      exitCode: 1,
      stdout: "",
      stderr: "",
    }))
    const clock = new MemoryFunnelClock()
    const sleep = async (ms: number): Promise<void> => {
      clock.advance(ms)
    }
    const gateway = new FunnelGateway({ fs, process: runner, clock, sleep })

    await gateway.start({ caffeinate: false })

    const detach = runner.calls.find((c) => c.kind === "detach")
    expect(detach?.command[0]).toBe("bash")
    expect(detach?.command[1]).toBe("-c")
    expect(detach?.command[2]).toContain("nohup")
    expect(detach?.command[2]).not.toContain("caffeinate")
  })
})
