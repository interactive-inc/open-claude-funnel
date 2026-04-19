import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/modules/fs/memory-funnel-file-system"
import { FunnelMcp } from "@/modules/mcp/funnel-mcp"

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
    expect(config.mcpServers?.funnel).toEqual({ command: "funnel", args: ["mcp"] })
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
    expect(config.mcpServers?.funnel?.command).toBe("funnel")
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
    expect(config.mcpServers?.["custom-key"]).toEqual({ command: "funnel", args: ["mcp"] })
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
    expect(config.mcpServers?.funnel?.command).toBe("funnel")
  })

  test("install fails when the repository does not exist", () => {
    const fs = new MemoryFunnelFileSystem()

    expect(() => new FunnelMcp({ fs }).install("/missing")).toThrow(/does not exist/)
  })
})
