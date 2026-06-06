import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelLocalConfigWriter } from "@/services/local-config/local-config-writer"

describe("FunnelLocalConfigWriter", () => {
  test("is a no-op when funnel.json is absent", () => {
    const fs = new MemoryFunnelFileSystem()
    const writer = new FunnelLocalConfigWriter({ fs })

    writer.ensureId("/repo", "uuid-1")

    expect(fs.existsSync("/repo/funnel.json")).toBe(false)
  })

  test("inserts id after $schema, keeping the other keys and order", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({
          $schema: "./schema.json",
          channels: [{ name: "ops" }],
          profiles: [{ channel: "ops" }],
        }),
      },
    })
    const writer = new FunnelLocalConfigWriter({ fs })

    writer.ensureId("/repo", "uuid-1")

    const written = fs.readFileSync("/repo/funnel.json")

    expect(written.endsWith("\n")).toBe(true)
    expect(JSON.parse(written)).toEqual({
      $schema: "./schema.json",
      id: "uuid-1",
      channels: [{ name: "ops" }],
      profiles: [{ channel: "ops" }],
    })
    expect(Object.keys(JSON.parse(written))).toEqual(["$schema", "id", "channels", "profiles"])
  })

  test("is a no-op when id is already present", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({ id: "existing", channels: [{ name: "ops" }] }),
      },
    })
    const writer = new FunnelLocalConfigWriter({ fs })

    writer.ensureId("/repo", "uuid-1")

    expect(JSON.parse(fs.readFileSync("/repo/funnel.json")).id).toEqual("existing")
  })

  test("preserves unknown keys at the tail", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({ channels: [{ name: "ops" }], future: { x: 1 } }),
      },
    })
    const writer = new FunnelLocalConfigWriter({ fs })

    writer.ensureId("/repo", "uuid-1")

    const parsed = JSON.parse(fs.readFileSync("/repo/funnel.json"))

    expect(Object.keys(parsed)).toEqual(["id", "channels", "future"])
    expect(parsed.future).toEqual({ x: 1 })
  })
})
