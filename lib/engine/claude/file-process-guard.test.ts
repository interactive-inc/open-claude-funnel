import { describe, expect, test } from "bun:test"
import { FileProcessGuard } from "@/engine/claude/file-process-guard"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelProcessRunner } from "@/engine/process/memory-process-runner"

const buildGuard = () => {
  const fs = new MemoryFunnelFileSystem({ dirs: ["/funnel"] })
  const process = new MemoryFunnelProcessRunner()
  const guard = new FileProcessGuard({ fs, process, dir: "/funnel" })

  return { guard, fs, process }
}

describe("FileProcessGuard", () => {
  test("isRunning returns false when no PID file exists", () => {
    const { guard } = buildGuard()

    expect(guard.isRunning("prof-1")).toBe(false)
  })

  test("acquire writes a PID file and isRunning returns true for a live process", () => {
    const { guard, process } = buildGuard()

    process.onIsAlive(() => true)
    guard.acquire("prof-1")

    expect(guard.isRunning("prof-1")).toBe(true)
  })

  test("release removes the PID file and isRunning returns false afterwards", () => {
    const { guard, process } = buildGuard()

    process.onIsAlive(() => true)
    guard.acquire("prof-1")
    guard.release("prof-1")

    expect(guard.isRunning("prof-1")).toBe(false)
  })

  test("isRunning returns false when the process is dead", () => {
    const { guard, process } = buildGuard()

    process.onIsAlive(() => false)
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
    guard.acquire("prof-1")

    expect(guard.isRunning("prof-1")).toBe(true)
    expect(guard.isRunning("prof-2")).toBe(false)
  })
})
