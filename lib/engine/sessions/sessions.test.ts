import { describe, expect, test } from "bun:test"
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
  test("get returns null when no session has been recorded", () => {
    const { sessions } = buildSessions()

    expect(sessions.get("ch1", "dev")).toBeNull()
  })

  test("create generates and persists a new session id", () => {
    const { sessions, fs } = buildSessions()

    const id = sessions.create("ch1", "dev")

    expect(id).toEqual("sess-1")
    expect(fs.existsSync("/funnel/channels/ch1/sessions.json")).toBe(true)
    expect(sessions.get("ch1", "dev")).toEqual(id)
  })

  test("create overwrites a prior entry so each call yields a fresh id", () => {
    const { sessions } = buildSessions()

    const first = sessions.create("ch1", "dev")
    const second = sessions.create("ch1", "dev")

    expect(second).not.toEqual(first)
    expect(sessions.get("ch1", "dev")).toEqual(second)
  })

  test("create uses distinct ids for different profiles under the same channel", () => {
    const { sessions } = buildSessions()

    const a = sessions.create("ch1", "alpha")
    const b = sessions.create("ch1", "beta")

    expect(a).not.toEqual(b)
  })

  test("create uses distinct ids for different channels under the same profile", () => {
    const { sessions } = buildSessions()

    const a = sessions.create("ch1", "dev")
    const b = sessions.create("ch2", "dev")

    expect(a).not.toEqual(b)
  })

  test("clear drops the entry so the next get returns null", () => {
    const { sessions } = buildSessions()

    sessions.create("ch1", "dev")
    sessions.clear("ch1", "dev")

    expect(sessions.get("ch1", "dev")).toBeNull()
  })

  test("clearAll removes the channel's session file entirely", () => {
    const { sessions, fs } = buildSessions()

    sessions.create("ch1", "dev")
    sessions.clearAll("ch1")

    expect(fs.existsSync("/funnel/channels/ch1/sessions.json")).toBe(false)
  })

  test("survives a malformed sessions.json by treating it as empty", () => {
    const { sessions, fs } = buildSessions()

    fs.mkdirSync("/funnel/channels/ch1", { recursive: true })
    fs.writeFileSync("/funnel/channels/ch1/sessions.json", "not json")

    const id = sessions.create("ch1", "dev")

    expect(id).toEqual("sess-1")
  })
})
