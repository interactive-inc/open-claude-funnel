import { describe, expect, test } from "bun:test"
import { defaultEventDbPath } from "@/gateway/default-event-db-path"

describe("defaultEventDbPath", () => {
  test("is stable for the same durable endpoint", () => {
    const props = { tmpDir: "/tmp/funnel", funnelDir: "/home/a/.funnel", port: 9743 }

    expect(defaultEventDbPath(props)).toBe(defaultEventDbPath(props))
  })

  test("isolates different state roots and ports", () => {
    const base = { tmpDir: "/tmp/funnel", funnelDir: "/home/a/.funnel", port: 9743 }
    const otherDir = { ...base, funnelDir: "/home/b/.funnel" }
    const otherPort = { ...base, port: 9742 }

    expect(defaultEventDbPath(base)).not.toBe(defaultEventDbPath(otherDir))
    expect(defaultEventDbPath(base)).not.toBe(defaultEventDbPath(otherPort))
  })

  test("isolates separate ephemeral port-zero instances", () => {
    const props = { tmpDir: "/tmp/funnel", funnelDir: "/home/a/.funnel", port: 0 }

    expect(defaultEventDbPath(props)).not.toBe(defaultEventDbPath(props))
  })
})
