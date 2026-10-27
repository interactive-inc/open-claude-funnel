import { describe, expect, test } from "bun:test"
import { dirname, resolve } from "node:path"
import { FunnelTransport } from "@/transport"
import { Funnel } from "@/funnel"
import { scheduleConnector } from "@/engine/connectors/schedule"
import { MockFunnelSettingsReader } from "@/engine/settings/mock-settings-reader"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"

describe("FunnelTransport", () => {
  test("has no runtime dependency on launchers, profiles, CLI or optional services", async () => {
    const visited = new Set<string>()
    const transpiler = new Bun.Transpiler({ loader: "ts" })
    const root = resolve(import.meta.dir)
    const visit = async (path: string): Promise<void> => {
      if (visited.has(path)) return
      visited.add(path)
      for (const entry of transpiler.scanImports(
        transpiler.transformSync(await Bun.file(path).text()),
      )) {
        const target = entry.path.startsWith("@/")
          ? resolve(root, entry.path.slice(2))
          : entry.path.startsWith(".")
            ? resolve(dirname(path), entry.path)
            : null
        if (target)
          await visit(
            (await Bun.file(`${target}.ts`).exists()) ? `${target}.ts` : `${target}/index.ts`,
          )
      }
    }
    await visit(resolve(root, "transport.ts"))
    expect(
      [...visited].filter((path) => /\/(cli|services|engine\/(claude|mcp|profiles))\//.test(path)),
    ).toEqual([])
  })

  test("embedded delivery and replay work without an agent runtime or a daemon", async () => {
    const transport = FunnelTransport.inMemory({ connectors: [scheduleConnector()] })
    transport.channels.add({ name: "ops" })
    const eventLog = new MemoryFunnelEventLog()
    const gateway = transport.gatewayModule({ eventLog, token: "test-token" })
    const received: string[] = []
    gateway.onEvent((event) => received.push(event.content))
    await gateway.start()
    try {
      const published = gateway.emit({ channel: "ops", content: "hello" })
      expect(received).toEqual(["hello"])
      expect(eventLog.loadSince(0).map((event) => event.content)).toEqual(["hello"])
      expect(published.offset).toBeGreaterThan(0)
      const unauthorized = await gateway.app.request("/channels/ops/publish", {
        method: "POST",
        body: JSON.stringify({ content: "blocked" }),
        headers: { "content-type": "application/json" },
      })
      expect(unauthorized.status).toBe(401)
      expect("claude" in transport).toBe(false)
      expect("gateway" in transport).toBe(false)
      expect("doctor" in transport).toBe(false)
    } finally {
      await gateway.stop()
      eventLog.close()
    }
  })

  test("the full facade and transport share settings, and protect saved profile references", () => {
    const store = new MockFunnelSettingsReader()
    const funnel = Funnel.inMemory({ store })
    const channel = funnel.transport.channels.add({ name: "ops" })
    funnel.profiles.add({ name: "worker", path: "/repo", channelId: channel.id })
    expect(funnel.channels).toBe(funnel.transport.channels)
    const transport = FunnelTransport.inMemory({ store })
    expect(() => transport.channels.remove("ops")).toThrow("referenced by a profile")
    funnel.profiles.remove("worker")
    transport.channels.remove("ops")
    expect(funnel.channels.get("ops")).toBeNull()
  })
})
