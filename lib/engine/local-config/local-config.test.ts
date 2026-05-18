import { describe, expect, test } from "vitest"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelLocalConfig } from "@/engine/local-config/local-config"

describe("FunnelLocalConfig", () => {
  test("returns null when funnel.json is missing", () => {
    const fs = new MemoryFunnelFileSystem()
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")).toBeNull()
  })

  test("parses channel-only config", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/funnel.json": JSON.stringify({ channel: "ops" }) },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")).toEqual({ channel: "ops" })
  })

  test("parses channel + options + env", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channel: "ops",
          options: ["--brief", "--agent", "developer"],
          env: { ANTHROPIC_MODEL: "claude-sonnet-4-6" },
        }),
      },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")).toEqual({
      channel: "ops",
      options: ["--brief", "--agent", "developer"],
      env: { ANTHROPIC_MODEL: "claude-sonnet-4-6" },
    })
  })

  test("throws on malformed JSON", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/funnel.json": "{ broken" },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(() => config.read("/repo")).toThrow(/not valid JSON/)
  })

  test("throws when channel is missing", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/funnel.json": JSON.stringify({ options: ["--brief"] }) },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(() => config.read("/repo")).toThrow(/is invalid/)
  })
})
