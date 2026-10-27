import { describe, expect, test } from "bun:test"
import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"
const config = { id: "gh", name: "github", type: "gh" as const, token: "test-token" }
describe("GitHub connection adapter", () => {
  test("uses the supplied token for REST reads and writes without executing gh", async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"id":1}' }))
    const adapter = new FunnelGhAdapter({ config, http })
    expect(await adapter.call({ method: "GET", path: "/repos/example/repo/issues" })).toEqual({
      id: 1,
    })
    await adapter.call({
      method: "POST",
      path: "repos/example/repo/issues",
      body: { title: "test" },
    })
    expect(http.calls[0]?.url).toBe("https://api.github.com/repos/example/repo/issues")
    expect(http.calls[0]?.headers?.Authorization).toBe("Bearer test-token")
    expect(http.calls[1]?.body).toBe('{"title":"test"}')
  })
  test("rejects missing credentials instead of looking for a CLI login", () => {
    expect(
      () => new FunnelGhAdapter({ config: { ...config, token: undefined }, env: {} }),
    ).toThrow()
  })
  test("surfaces HTTP failures and handles empty responses", async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ status: 403, body: "denied" }))
    const adapter = new FunnelGhAdapter({ config, http })
    await expect(adapter.call({ method: "GET", path: "user" })).rejects.toThrow("403")
    http.on(() => ({ status: 204 }))
    expect(await adapter.call({ method: "DELETE", path: "notifications" })).toBeNull()
  })
})
