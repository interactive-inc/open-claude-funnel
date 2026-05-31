import { describe, expect, test } from "bun:test"
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

  test("parses the repo id when present", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({ id: "uuid-1", channels: [{ name: "ops" }] }),
      },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")).toEqual({ id: "uuid-1", channels: [{ name: "ops" }] })
  })

  test("parses profiles bound to channels with options/env/resume", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }, { name: "review" }],
          profiles: [
            {
              name: "pm",
              channel: "ops",
              options: ["--brief", "--agent", "pm"],
              env: { ANTHROPIC_MODEL: "claude-sonnet-4-6" },
            },
            { name: "rev", channel: "review", env: { EXTRA: "1" }, resume: false },
          ],
        }),
      },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")).toEqual({
      channels: [{ name: "ops" }, { name: "review" }],
      profiles: [
        {
          name: "pm",
          channel: "ops",
          options: ["--brief", "--agent", "pm"],
          env: { ANTHROPIC_MODEL: "claude-sonnet-4-6" },
        },
        { name: "rev", channel: "review", env: { EXTRA: "1" }, resume: false },
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

  test("throws when a profile binds an undeclared channel", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }],
          profiles: [{ name: "pm", channel: "opss", options: ["--agent", "pm"] }],
        }),
      },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(() => config.read("/repo")).toThrow(/not declared in channels/)
  })

  test("throws when two profiles share a name", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }],
          profiles: [
            { name: "dup", channel: "ops" },
            { name: "dup", channel: "ops" },
          ],
        }),
      },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(() => config.read("/repo")).toThrow(/names must be unique/)
  })

  test("accepts multiple profiles bound to the same channel", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }],
          profiles: [
            { name: "pm", channel: "ops", options: ["--agent", "pm"] },
            { name: "dev", channel: "ops", options: ["--agent", "developer"] },
          ],
        }),
      },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")?.profiles).toHaveLength(2)
  })

  test("accepts one profile per declared channel", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/funnel.json": JSON.stringify({
          channels: [{ name: "ops" }, { name: "review" }],
          profiles: [
            { name: "pm", channel: "ops", options: ["--agent", "pm"] },
            { name: "reviewer", channel: "review", options: ["--agent", "reviewer"] },
          ],
        }),
      },
    })
    const config = new FunnelLocalConfig({ fs })

    expect(config.read("/repo")?.profiles).toHaveLength(2)
  })
})
