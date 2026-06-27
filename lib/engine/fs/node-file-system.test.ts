import { mkdtempSync, rmSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, test } from "bun:test"
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system"

const makeTmpDir = (): string => mkdtempSync(join(tmpdir(), "funnel-fs-test-"))

describe("NodeFunnelFileSystem.withFileLock", () => {
  test("releases the lock file after fn returns", () => {
    const dir = makeTmpDir()
    const lockPath = join(dir, "x.lock")
    const fs = new NodeFunnelFileSystem()

    try {
      const result = fs.withFileLock(lockPath, () => 42)

      expect(result).toBe(42)
      expect(existsSync(lockPath)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("releases the lock file when fn throws", () => {
    const dir = makeTmpDir()
    const lockPath = join(dir, "x.lock")
    const fs = new NodeFunnelFileSystem()

    try {
      expect(() => {
        fs.withFileLock(lockPath, () => {
          throw new Error("boom")
        })
      }).toThrow("boom")

      expect(existsSync(lockPath)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("breaks a stale lock whose owning pid is dead", () => {
    const dir = makeTmpDir()
    const lockPath = join(dir, "x.lock")
    const fs = new NodeFunnelFileSystem()

    try {
      // PID 1 (init) is always alive, so pick something practically guaranteed
      // dead — a very large number that no normal system would allocate.
      const deadPid = "2147483646"
      fs.writeFileSync(lockPath, deadPid)

      const result = fs.withFileLock(lockPath, () => "ok")

      expect(result).toBe("ok")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("NodeFunnelFileSystem.unlink", () => {
  test("silent on ENOENT", () => {
    const fs = new NodeFunnelFileSystem()
    expect(() => fs.unlink(join(makeTmpDir(), "absent"))).not.toThrow()
  })
})
