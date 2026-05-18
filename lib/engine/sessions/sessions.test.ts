import { describe, expect, test } from "vitest"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { FunnelSessions } from "@/engine/sessions/sessions"

const buildSessions = () => {
  const fs = new MemoryFunnelFileSystem({ dirs: ["/funnel"] })
  const idGenerator = new MemoryFunnelIdGenerator({ prefix: "sess" })
  const sessions = new FunnelSessions({ fs, idGenerator, dir: "/funnel" })

  return { sessions, fs }
}

describe("FunnelSessions", () => {
  test("generates and persists a new session id on first call", () => {
    const { sessions, fs } = buildSessions()

    const id = sessions.getOrCreate("ch1", "/repo")

    expect(id).toEqual("sess-1")
    expect(fs.existsSync("/funnel/channels/ch1/sessions.json")).toBe(true)
  })

  test("returns the same id on subsequent calls for the same (channel, cwd)", () => {
    const { sessions } = buildSessions()

    const first = sessions.getOrCreate("ch1", "/repo")
    const second = sessions.getOrCreate("ch1", "/repo")

    expect(second).toEqual(first)
  })

  test("uses distinct ids for different cwds under the same channel", () => {
    const { sessions } = buildSessions()

    const a = sessions.getOrCreate("ch1", "/repo-a")
    const b = sessions.getOrCreate("ch1", "/repo-b")

    expect(a).not.toEqual(b)
  })

  test("uses distinct ids for different channels under the same cwd", () => {
    const { sessions } = buildSessions()

    const a = sessions.getOrCreate("ch1", "/repo")
    const b = sessions.getOrCreate("ch2", "/repo")

    expect(a).not.toEqual(b)
  })

  test("get returns null when no session has been recorded", () => {
    const { sessions } = buildSessions()

    expect(sessions.get("ch1", "/repo")).toBeNull()
  })

  test("clear drops the entry so the next getOrCreate makes a fresh id", () => {
    const { sessions } = buildSessions()

    const first = sessions.getOrCreate("ch1", "/repo")

    sessions.clear("ch1", "/repo")

    const second = sessions.getOrCreate("ch1", "/repo")

    expect(second).not.toEqual(first)
  })

  test("clearAll removes the channel's session file entirely", () => {
    const { sessions, fs } = buildSessions()

    sessions.getOrCreate("ch1", "/repo")
    sessions.clearAll("ch1")

    expect(fs.existsSync("/funnel/channels/ch1/sessions.json")).toBe(false)
  })

  test("survives a malformed sessions.json by treating it as empty", () => {
    const { sessions, fs } = buildSessions()

    fs.mkdirSync("/funnel/channels/ch1", { recursive: true })
    fs.writeFileSync("/funnel/channels/ch1/sessions.json", "not json")

    const id = sessions.getOrCreate("ch1", "/repo")

    expect(id).toEqual("sess-1")
  })
})
