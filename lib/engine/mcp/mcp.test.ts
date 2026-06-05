import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelMcp } from "@/engine/mcp/mcp"

const readJson = (
  fs: MemoryFunnelFileSystem,
  path: string,
): { mcpServers?: Record<string, { command?: string; args?: string[] }> } =>
  JSON.parse(fs.readFileSync(path))

describe("FunnelMcp", () => {
  test("install writes funnel into .mcp.json", () => {
    const fs = new MemoryFunnelFileSystem({ dirs: ["/repo"] })

    new FunnelMcp({ fs }).install("/repo")

    const config = readJson(fs, "/repo/.mcp.json")
    expect(config.mcpServers?.funnel).toEqual({ command: "bun", args: ["funnel", "mcp"] })
  })

  test("preserves other existing MCP entries", () => {
    const fs = new MemoryFunnelFileSystem({
      dirs: ["/repo"],
      files: {
        "/repo/.mcp.json": JSON.stringify({
          mcpServers: { other: { command: "other-bin", args: [] } },
        }),
      },
    })

    new FunnelMcp({ fs }).install("/repo")

    const config = readJson(fs, "/repo/.mcp.json")
    expect(config.mcpServers?.other?.command).toBe("other-bin")
    expect(config.mcpServers?.funnel?.command).toBe("bun")
  })

  test("install preserves third-party server fields and unrelated top-level keys", () => {
    const fs = new MemoryFunnelFileSystem({
      dirs: ["/repo"],
      files: {
        "/repo/.mcp.json": JSON.stringify({
          $schema: "https://example.com/mcp.schema.json",
          mcpServers: {
            slack: { type: "http", url: "https://mcp.slack.com/mcp" },
            local: { command: "node", args: ["server.js"], env: { API_KEY: "secret" } },
          },
        }),
      },
    })

    new FunnelMcp({ fs }).install("/repo")

    const config = JSON.parse(fs.readFileSync("/repo/.mcp.json"))

    // The funnel entry is added without stripping anything else.
    expect(config.$schema).toBe("https://example.com/mcp.schema.json")
    expect(config.mcpServers.slack).toEqual({ type: "http", url: "https://mcp.slack.com/mcp" })
    expect(config.mcpServers.local).toEqual({
      command: "node",
      args: ["server.js"],
      env: { API_KEY: "secret" },
    })
    expect(config.mcpServers.funnel).toEqual({ command: "bun", args: ["funnel", "mcp"] })
  })

  test("uninstall preserves third-party server fields and top-level keys", () => {
    const fs = new MemoryFunnelFileSystem({
      dirs: ["/repo"],
      files: {
        "/repo/.mcp.json": JSON.stringify({
          $schema: "https://example.com/mcp.schema.json",
          mcpServers: {
            slack: { type: "http", url: "https://mcp.slack.com/mcp" },
            funnel: { command: "bun", args: ["funnel", "mcp"] },
          },
        }),
      },
    })

    new FunnelMcp({ fs }).uninstall("/repo")

    const config = JSON.parse(fs.readFileSync("/repo/.mcp.json"))
    expect(config.$schema).toBe("https://example.com/mcp.schema.json")
    expect(config.mcpServers.slack).toEqual({ type: "http", url: "https://mcp.slack.com/mcp" })
    expect(config.mcpServers.funnel).toBeUndefined()
  })

  test("findInstalledName returns the key whose command is funnel", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/.mcp.json": JSON.stringify({
          mcpServers: { "my-funnel": { command: "funnel", args: ["mcp"] } },
        }),
      },
    })

    expect(new FunnelMcp({ fs }).findInstalledName("/repo")).toBe("my-funnel")
  })

  test("install preserves the existing key name", () => {
    const fs = new MemoryFunnelFileSystem({
      dirs: ["/repo"],
      files: {
        "/repo/.mcp.json": JSON.stringify({
          mcpServers: { "custom-key": { command: "funnel", args: ["mcp"] } },
        }),
      },
    })

    new FunnelMcp({ fs }).install("/repo")

    const config = readJson(fs, "/repo/.mcp.json")
    expect(config.mcpServers?.["custom-key"]).toEqual({ command: "bun", args: ["funnel", "mcp"] })
    expect(config.mcpServers?.funnel).toBeUndefined()
  })

  test("uninstall removes entries whose command is funnel", () => {
    const fs = new MemoryFunnelFileSystem({ dirs: ["/repo"] })
    const mcp = new FunnelMcp({ fs })

    mcp.install("/repo")
    mcp.uninstall("/repo")

    const config = readJson(fs, "/repo/.mcp.json")
    expect(config.mcpServers?.funnel).toBeUndefined()
  })

  test("install works even when .mcp.json is empty", () => {
    const fs = new MemoryFunnelFileSystem({
      dirs: ["/repo"],
      files: { "/repo/.mcp.json": "" },
    })

    new FunnelMcp({ fs }).install("/repo")

    const config = readJson(fs, "/repo/.mcp.json")
    expect(config.mcpServers?.funnel?.command).toBe("bun")
  })

  test("install fails when the repository does not exist", () => {
    const fs = new MemoryFunnelFileSystem()

    expect(() => new FunnelMcp({ fs }).install("/missing")).toThrow(/does not exist/)
  })
})
