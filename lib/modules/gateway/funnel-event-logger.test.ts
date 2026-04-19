import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"
import { FunnelEventLogger } from "@/modules/gateway/funnel-event-logger"

const LOG_DIR = "/tmp/funnel-logs"

describe("FunnelEventLogger", () => {
  test("log appends one line to <date>.jsonl", () => {
    const fs = new MemoryFunnelFileSystem()
    const now = () => Date.parse("2026-04-19T10:00:00Z")
    const logger = new FunnelEventLogger({ logDir: LOG_DIR, fs, now })

    logger.log("hello", { event_type: "slack", channel_id: "C1" })

    const file = `${LOG_DIR}/2026-04-19.jsonl`
    expect(fs.existsSync(file)).toBe(true)

    const content = fs.readFileSync(file)
    expect(content).toContain('"eventType":"slack"')
    expect(content).toContain('"content":"hello"')
    expect(content.endsWith("\n")).toBe(true)
  })

  test("rotate deletes .jsonl files older than 30 days", () => {
    const now = () => Date.parse("2026-04-19T10:00:00Z")
    const oldFile = `${LOG_DIR}/2026-03-01.jsonl`
    const freshFile = `${LOG_DIR}/2026-04-15.jsonl`
    const other = `${LOG_DIR}/something.txt`
    const fs = new MemoryFunnelFileSystem({
      dirs: [LOG_DIR],
      files: {
        [oldFile]: "a\n",
        [freshFile]: "b\n",
        [other]: "c",
      },
      mtimes: {
        [oldFile]: Date.parse("2026-03-01T00:00:00Z"),
        [freshFile]: Date.parse("2026-04-15T00:00:00Z"),
        [other]: Date.parse("2026-01-01T00:00:00Z"),
      },
    })

    new FunnelEventLogger({ logDir: LOG_DIR, fs, now })

    expect(fs.existsSync(oldFile)).toBe(false)
    expect(fs.existsSync(freshFile)).toBe(true)
    // non-.jsonl files are left alone
    expect(fs.existsSync(other)).toBe(true)
  })

  test("multiple logs are appended", () => {
    const fs = new MemoryFunnelFileSystem()
    const now = () => Date.parse("2026-04-19T10:00:00Z")
    const logger = new FunnelEventLogger({ logDir: LOG_DIR, fs, now })

    logger.log("a")
    logger.log("b")

    const file = `${LOG_DIR}/2026-04-19.jsonl`
    const lines = fs.readFileSync(file).trim().split("\n")
    expect(lines).toHaveLength(2)
  })
})
