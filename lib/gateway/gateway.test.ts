import { describe, expect, test } from "vitest"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelGateway } from "@/gateway/gateway"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

const PID_FILE = `${process.env.HOME}/.funnel/gateway.pid`

describe("FunnelGateway", () => {
  test("macOS default wraps with caffeinate -is", () => {
    const command = new FunnelGateway().buildStartCommand("/path/to/daemon.ts")

    if (process.platform === "darwin") {
      expect(command[0]).toBe("caffeinate")
      expect(command[1]).toBe("-is")
      expect(command[2]).toBe("bun")
      expect(command[3]).toBe("/path/to/daemon.ts")
    } else {
      expect(command[0]).toBe("bun")
      expect(command[1]).toBe("/path/to/daemon.ts")
    }
  })

  test("caffeinate=false (like --no-caffeine) omits caffeinate", () => {
    const command = new FunnelGateway().buildStartCommand("/x", { caffeinate: false })

    expect(command).not.toContain("caffeinate")
    expect(command[0]).toBe("bun")
    expect(command[1]).toBe("/x")
  })

  test("appends funnel-gateway[<dir>] tag so process listings can scope kill-competing", () => {
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

  test("PID exists but liveness check fails → false", () => {
    const fs = new MemoryFunnelFileSystem({ files: { [PID_FILE]: "12345" } })
    const runner = new MemoryFunnelProcessRunner().onIsAlive(() => false)

    expect(new FunnelGateway({ fs, process: runner }).isRunning()).toBe(false)
  })

  test("PID exists and process is alive → true", () => {
    const fs = new MemoryFunnelFileSystem({ files: { [PID_FILE]: "12345" } })
    const runner = new MemoryFunnelProcessRunner().onIsAlive((pid) => pid === 12345)

    expect(new FunnelGateway({ fs, process: runner }).isRunning()).toBe(true)
  })

  test("start spawns daemon directly via detach with log file redirection", async () => {
    const fs = new MemoryFunnelFileSystem()
    const runner = new MemoryFunnelProcessRunner().onIsAlive(() => false)
    const clock = new MemoryFunnelClock()
    const sleep = async (ms: number): Promise<void> => {
      clock.advance(ms)
    }
    const gateway = new FunnelGateway({
      fs,
      process: runner,
      clock,
      sleep,
      dir: "/scoped/funnel",
      tmpDir: "/scoped/tmp",
      port: 18_888,
    })

    await gateway.start({ caffeinate: false })

    const detach = runner.calls.find((c) => c.kind === "detach")
    expect(detach).toBeDefined()
    if (detach?.kind !== "detach") return
    expect(detach.command[0]).toBe("bun")
    expect(detach.command).not.toContain("caffeinate")
    expect(detach.command).not.toContain("nohup")
    expect(detach.options.stdoutFile).toBeTruthy()
    expect(detach.options.stderrFile).toBeTruthy()
    expect(detach.options.env).toEqual({
      FUNNEL_DIR: "/scoped/funnel",
      FUNNEL_PORT: "18888",
      FUNNEL_TMP_DIR: "/scoped/tmp",
    })
  })
})
