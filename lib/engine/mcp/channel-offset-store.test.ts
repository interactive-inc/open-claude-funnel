import { describe, expect, test } from "vitest"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelChannelOffsetStore } from "@/engine/mcp/channel-offset-store"

const buildStore = () => {
  const fs = new MemoryFunnelFileSystem({ dirs: ["/funnel"] })
  const warnings: string[] = []
  const store = new FunnelChannelOffsetStore({
    fs,
    dir: "/funnel",
    warn: (msg) => warnings.push(msg),
  })

  return { store, fs, warnings }
}

describe("FunnelChannelOffsetStore", () => {
  test("get returns 0 when no offset has been recorded", () => {
    const { store } = buildStore()

    expect(store.get("ch1", "/repo")).toBe(0)
  })

  test("set persists an offset that get reads back", () => {
    const { store, fs } = buildStore()

    store.set("ch1", "/repo", 42)

    expect(store.get("ch1", "/repo")).toBe(42)
    expect(fs.existsSync("/funnel/channels/ch1/offsets.json")).toBe(true)
  })

  test("set overwrites a prior offset", () => {
    const { store } = buildStore()

    store.set("ch1", "/repo", 10)
    store.set("ch1", "/repo", 25)

    expect(store.get("ch1", "/repo")).toBe(25)
  })

  test("different cwds under the same channel are isolated", () => {
    const { store } = buildStore()

    store.set("ch1", "/repo-a", 7)
    store.set("ch1", "/repo-b", 99)

    expect(store.get("ch1", "/repo-a")).toBe(7)
    expect(store.get("ch1", "/repo-b")).toBe(99)
  })

  test("different channels under the same cwd are isolated", () => {
    const { store } = buildStore()

    store.set("ch1", "/repo", 7)
    store.set("ch2", "/repo", 99)

    expect(store.get("ch1", "/repo")).toBe(7)
    expect(store.get("ch2", "/repo")).toBe(99)
  })

  test("survives a malformed offsets.json by treating it as empty and warning", () => {
    const { store, fs, warnings } = buildStore()

    fs.mkdirSync("/funnel/channels/ch1", { recursive: true })
    fs.writeFileSync("/funnel/channels/ch1/offsets.json", "not json")

    expect(store.get("ch1", "/repo")).toBe(0)
    expect(warnings.some((w) => w.includes("corrupted offsets"))).toBe(true)

    store.set("ch1", "/repo", 5)

    expect(store.get("ch1", "/repo")).toBe(5)
  })

  test("warns when offsets.json parses but does not match the schema", () => {
    const { store, fs, warnings } = buildStore()

    fs.mkdirSync("/funnel/channels/ch1", { recursive: true })
    fs.writeFileSync("/funnel/channels/ch1/offsets.json", JSON.stringify({ "/repo": "ten" }))

    expect(store.get("ch1", "/repo")).toBe(0)
    expect(warnings.some((w) => w.includes("did not match schema"))).toBe(true)
  })

  test("set with a non-positive offset is treated as a clear", () => {
    const { store } = buildStore()

    store.set("ch1", "/repo", 42)
    store.set("ch1", "/repo", 0)

    expect(store.get("ch1", "/repo")).toBe(0)
  })
})
