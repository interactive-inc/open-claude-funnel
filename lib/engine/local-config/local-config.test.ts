import { describe, expect, test } from "vitest"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelLocalConfig } from "@/engine/local-config/local-config"

describe("FunnelLocalConfig", () => {
  test("returns null when funnel.json is missing", () => {
    const fs = new MemoryFunnelFileSystem()
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")).toBeNull()
  })

  test("parses a single-channel config", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/funnel.json": JSON.stringify({ channels: [{ name: "ops" }] }) },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")).toEqual({ channels: [{ name: "ops" }] })
  })

  test("parses profiles bound to channels with options/env/resume", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }, { name: "review" }],
          profiles: [
            {
              name: "ops-pm",
              channel: "ops",
              options: ["--brief", "--agent", "pm"],
              env: { ANTHROPIC_MODEL: "claude-sonnet-4-6" },
            },
            { name: "review-extra", channel: "review", env: { EXTRA: "1" }, resume: false },
          ],
        }),
      },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")).toEqual({
      channels: [{ name: "ops" }, { name: "review" }],
      profiles: [
        {
          name: "ops-pm",
          channel: "ops",
          options: ["--brief", "--agent", "pm"],
          env: { ANTHROPIC_MODEL: "claude-sonnet-4-6" },
        },
        { name: "review-extra", channel: "review", env: { EXTRA: "1" }, resume: false },
      ],
    })
  })

  test("strips unknown legacy channel recipe keys", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops", options: ["--brief"], env: { X: "1" }, resume: false }],
        }),
      },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")).toEqual({ channels: [{ name: "ops" }] })
  })

  test("throws on malformed JSON", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/funnel.json": "{ broken" },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(() => config.read("/repo")).toThrow(/not valid JSON/)
  })

  test("throws when channels is missing", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/funnel.json": JSON.stringify({ options: ["--brief"] }) },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(() => config.read("/repo")).toThrow(/is invalid/)
  })

  test("throws when channels array is empty", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/funnel.json": JSON.stringify({ channels: [] }) },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(() => config.read("/repo")).toThrow(/is invalid/)
  })
})
