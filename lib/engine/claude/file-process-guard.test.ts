import { describe, expect, test } from "vitest"
import { FunnelFileProcessGuard } from "@/engine/claude/file-process-guard"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"

const buildGuard = () => {
  const fs = new MemoryFunnelFileSystem({ dirs: ["/funnel"] })
  const process = new MemoryFunnelProcessRunner()
  const guard = new FunnelFileProcessGuard({ fs, process, dir: "/funnel" })

  return { guard, fs, process }
}

describe("FunnelFileProcessGuard", () => {
  test("isRunning returns false when no PID file exists", () => {
    const { guard } = buildGuard()

    expect(guard.isRunning("prof-1")).toBe(false)
  })

  test("acquire writes a PID file and isRunning returns true for a live process", () => {
    const { guard, process } = buildGuard()

    process.onIsAlive(() => true)
    process.onGetStartTime(() => "Mon Jun  9 06:45:00 2026")
    guard.acquire("prof-1")

    expect(guard.isRunning("prof-1")).toBe(true)
  })

  test("release removes the PID file and isRunning returns false afterwards", () => {
    const { guard, process } = buildGuard()

    process.onIsAlive(() => true)
    process.onGetStartTime(() => "Mon Jun  9 06:45:00 2026")
    guard.acquire("prof-1")
    guard.release("prof-1")

    expect(guard.isRunning("prof-1")).toBe(false)
  })

  test("isRunning returns false when the process is dead", () => {
    const { guard, process } = buildGuard()

    process.onIsAlive(() => false)
    process.onGetStartTime(() => "Mon Jun  9 06:45:00 2026")
    guard.acquire("prof-1")

    expect(guard.isRunning("prof-1")).toBe(false)
  })

  test("isRunning returns false when PID file contains empty string", () => {
    const { guard, fs } = buildGuard()

    fs.mkdirSync("/funnel/claude", { recursive: true })
    fs.writeFileSync("/funnel/claude/prof-1.pid", "")

    expect(guard.isRunning("prof-1")).toBe(false)
  })

  test("isRunning returns false when PID file contains NaN", () => {
    const { guard, fs } = buildGuard()

    fs.mkdirSync("/funnel/claude", { recursive: true })
    fs.writeFileSync("/funnel/claude/prof-1.pid", "notanumber")

    expect(guard.isRunning("prof-1")).toBe(false)
  })

  test("isRunning returns false when PID file contains zero", () => {
    const { guard, fs } = buildGuard()

    fs.mkdirSync("/funnel/claude", { recursive: true })
    fs.writeFileSync("/funnel/claude/prof-1.pid", "0")

    expect(guard.isRunning("prof-1")).toBe(false)
  })

  test("release is a no-op when PID file does not exist", () => {
    const { guard } = buildGuard()

    expect(() => guard.release("prof-1")).not.toThrow()
  })

  test("two profiles have independent PID files", () => {
    const { guard, process } = buildGuard()

    process.onIsAlive((pid) => pid === globalThis.process.pid)
    process.onGetStartTime(() => "Mon Jun  9 06:45:00 2026")
    guard.acquire("prof-1")

    expect(guard.isRunning("prof-1")).toBe(true)
    expect(guard.isRunning("prof-2")).toBe(false)
  })

  test("isRunning self-heals stale PID file when process is dead", () => {
    const { guard, fs, process } = buildGuard()

    process.onIsAlive(() => false)
    fs.mkdirSync("/funnel/claude", { recursive: true })
    fs.writeFileSync(
      "/funnel/claude/prof-1.pid",
      JSON.stringify({ pid: 99999, startTime: "Mon Jun  9 06:45:00 2026" }),
    )

    expect(guard.isRunning("prof-1")).toBe(false)
    expect(fs.existsSync("/funnel/claude/prof-1.pid")).toBe(false)
  })

  test("isRunning self-heals when PID is reused by another process (startTime mismatch)", () => {
    const { guard, fs, process } = buildGuard()

    process.onIsAlive(() => true)
    process.onGetStartTime(() => "Tue Jun 10 12:00:00 2026")
    fs.mkdirSync("/funnel/claude", { recursive: true })
    fs.writeFileSync(
      "/funnel/claude/prof-1.pid",
      JSON.stringify({ pid: 99999, startTime: "Mon Jun  9 06:45:00 2026" }),
    )

    expect(guard.isRunning("prof-1")).toBe(false)
    expect(fs.existsSync("/funnel/claude/prof-1.pid")).toBe(false)
  })

  test("isRunning self-heals when startTime cannot be resolved for a live PID", () => {
    const { guard, fs, process } = buildGuard()

    process.onIsAlive(() => true)
    process.onGetStartTime(() => null)
    fs.mkdirSync("/funnel/claude", { recursive: true })
    fs.writeFileSync(
      "/funnel/claude/prof-1.pid",
      JSON.stringify({ pid: 99999, startTime: "Mon Jun  9 06:45:00 2026" }),
    )

    expect(guard.isRunning("prof-1")).toBe(false)
    expect(fs.existsSync("/funnel/claude/prof-1.pid")).toBe(false)
  })

  test("isRunning accepts legacy bare-number PID file (backwards compat)", () => {
    const { guard, fs, process } = buildGuard()

    process.onIsAlive(() => true)
    fs.mkdirSync("/funnel/claude", { recursive: true })
    fs.writeFileSync("/funnel/claude/prof-1.pid", "12345")

    expect(guard.isRunning("prof-1")).toBe(true)
  })

  test("acquire writes JSON record including startTime", () => {
    const { guard, fs, process } = buildGuard()

    process.onIsAlive(() => true)
    process.onGetStartTime(() => "Mon Jun  9 06:45:00 2026")
    guard.acquire("prof-1")

    const content = fs.readFileSync("/funnel/claude/prof-1.pid")
    const parsed = JSON.parse(content) as { pid: number; startTime: string }

    expect(parsed.pid).toBe(globalThis.process.pid)
    expect(parsed.startTime).toBe("Mon Jun  9 06:45:00 2026")
  })
})
