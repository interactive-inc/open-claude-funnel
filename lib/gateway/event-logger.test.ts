import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelEventLogger } from "@/gateway/event-logger"

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

  test("trims oldest entries when the cap is exceeded", () => {
    const fs = new MemoryFunnelFileSystem()
    const now = () => Date.parse("2026-04-19T10:00:00Z")
    const logger = new FunnelEventLogger({
      logDir: LOG_DIR,
      fs,
      now,
      maxLines: 5,
      trimToLines: 3,
    })

    for (let i = 0; i < 6; i++) logger.log(`event-${i}`)

    const file = `${LOG_DIR}/2026-04-19.jsonl`
    const lines = fs
      .readFileSync(file)
      .split("\n")
      .filter((l) => l.length > 0)

    // 6 events written, max 5 → trimmed to last 3
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('"content":"event-3"')
    expect(lines[2]).toContain('"content":"event-5"')
  })

  test("further logs after a trim continue appending", () => {
    const fs = new MemoryFunnelFileSystem()
    const now = () => Date.parse("2026-04-19T10:00:00Z")
    const logger = new FunnelEventLogger({
      logDir: LOG_DIR,
      fs,
      now,
      maxLines: 5,
      trimToLines: 3,
    })

    for (let i = 0; i < 6; i++) logger.log(`a-${i}`)
    logger.log("b-0")
    logger.log("b-1")

    const file = `${LOG_DIR}/2026-04-19.jsonl`
    const lines = fs
      .readFileSync(file)
      .split("\n")
      .filter((l) => l.length > 0)

    // 3 trimmed survivors + 2 fresh appends
    expect(lines).toHaveLength(5)
    expect(lines[0]).toContain('"content":"a-3"')
    expect(lines[3]).toContain('"content":"b-0"')
    expect(lines[4]).toContain('"content":"b-1"')
  })

  test("trim is amortized — only triggered when over cap, not every append", () => {
    const fs = new MemoryFunnelFileSystem()
    const now = () => Date.parse("2026-04-19T10:00:00Z")
    const logger = new FunnelEventLogger({
      logDir: LOG_DIR,
      fs,
      now,
      maxLines: 4,
      trimToLines: 2,
    })

    // 4 logs → still under cap, no trim
    for (let i = 0; i < 4; i++) logger.log(`e-${i}`)

    const file = `${LOG_DIR}/2026-04-19.jsonl`
    expect(
      fs
        .readFileSync(file)
        .split("\n")
        .filter((l) => l.length > 0),
    ).toHaveLength(4)

    // 5th log → exceeds cap → trim to 2
    logger.log("e-4")
    expect(
      fs
        .readFileSync(file)
        .split("\n")
        .filter((l) => l.length > 0),
    ).toHaveLength(2)
  })

  test("recovers line count for a pre-existing file", () => {
    const fs = new MemoryFunnelFileSystem()
    const now = () => Date.parse("2026-04-19T10:00:00Z")
    const file = `${LOG_DIR}/2026-04-19.jsonl`

    // simulate a daemon restart with 5 already-written lines
    fs.mkdirSync(LOG_DIR)
    fs.writeFileSync(
      file,
      `${["a", "b", "c", "d", "e"].map((c) => JSON.stringify({ content: c })).join("\n")}\n`,
    )

    const logger = new FunnelEventLogger({
      logDir: LOG_DIR,
      fs,
      now,
      maxLines: 5,
      trimToLines: 3,
    })

    // first append after restart pushes the count to 6, triggering a trim
    logger.log("f")

    const lines = fs
      .readFileSync(file)
      .split("\n")
      .filter((l) => l.length > 0)

    expect(lines).toHaveLength(3)
    expect(lines[2]).toContain('"content":"f"')
  })
})
