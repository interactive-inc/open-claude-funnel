import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelGatewayToken } from "@/gateway/gateway-token"

describe("FunnelGatewayToken", () => {
  test("ensure() generates and persists a token", () => {
    const fs = new MemoryFunnelFileSystem()
    const token = new FunnelGatewayToken({
      fs,
      dir: "/funnel",
      generate: () => "deadbeef",
    })

    expect(token.read()).toBeNull()
    expect(token.ensure()).toBe("deadbeef")
    expect(token.read()).toBe("deadbeef")
  })

  test("ensure() returns the existing token without regenerating", () => {
    const fs = new MemoryFunnelFileSystem()
    fs.writeSecretFileSync("/funnel/gateway.token", "stored\n")

    const token = new FunnelGatewayToken({
      fs,
      dir: "/funnel",
      generate: () => "should-not-be-used",
    })

    expect(token.ensure()).toBe("stored")
  })

  test("ensure() writes with mode 0o600", () => {
    const fs = new MemoryFunnelFileSystem()
    const token = new FunnelGatewayToken({
      fs,
      dir: "/funnel",
      generate: () => "abc",
    })

    token.ensure()

    expect(fs.statSync("/funnel/gateway.token").mode).toBe(0o600)
  })

  test("read() returns null for empty file", () => {
    const fs = new MemoryFunnelFileSystem()
    fs.writeSecretFileSync("/funnel/gateway.token", "   \n")

    const token = new FunnelGatewayToken({ fs, dir: "/funnel" })

    expect(token.read()).toBeNull()
  })
})
