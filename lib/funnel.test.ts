import { describe, expect, test } from "bun:test"
import { Funnel } from "@/index"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import { resolve, dirname } from "node:path"

describe("connection library", () => {
  test("host cancellation stops listeners without leaving recovery running", async () => {
    const controller = new AbortController()
    const funnel = new Funnel({
      signal: controller.signal,
      connectors: [scheduleConnector()],
      channels: [{ name: "ops", connectors: [{ name: "clock", type: "schedule" }] }],
    })
    const gateway = funnel.gatewayModule({ token: "test" })
    await gateway.start()
    expect(gateway.getRegistry().list()).toHaveLength(1)
    controller.abort()
    await gateway.stop()
    expect(gateway.getRegistry().list()).toEqual([])
    await expect(gateway.start()).rejects.toThrow()
  })

  test("host cancellation also closes a helper-owned HTTP socket", async () => {
    const controller = new AbortController()
    const server = new Funnel({ signal: controller.signal }).gatewayServer({
      port: 0,
      token: "test",
    })
    await server.start()
    const url = `http://127.0.0.1:${server.port}/health`
    expect((await fetch(url)).status).toBe(200)
    controller.abort()
    await server.stop()
    await expect(fetch(url)).rejects.toThrow()
  })

  test("a cancelled host never starts a socket", async () => {
    const server = new Funnel({ signal: AbortSignal.abort() }).gatewayServer({
      port: 0,
      token: "test",
    })
    await expect(server.start()).rejects.toThrow()
    expect(server.port).toBe(0)
    await server.stop()
  })

  test("accepts connection definitions directly and preserves host-owned IDs across reconstruction", () => {
    const configured = new Funnel({
      connectors: [scheduleConnector()],
      channels: [{ name: "ops", connectors: [{ name: "clock", type: "schedule" }] }],
    })
    const stored = new MemoryFunnelSettingsStore({ channels: configured.channels.list() })
    const restored = new Funnel({ store: stored, connectors: [scheduleConnector()] })
    expect(restored.channels.get("ops")?.id).toBe(configured.channels.get("ops")?.id)
    expect(restored.channels.getConnector("ops", "clock")?.id).toBe(
      configured.channels.getConnector("ops", "clock")?.id,
    )
    expect(() => new Funnel({ store: stored, channels: [] })).toThrow("not both")
  })

  test("rejects implicit authentication and port configuration", () => {
    const funnel = new Funnel()
    // @ts-expect-error JavaScript callers must also explicitly choose authentication.
    expect(() => funnel.gatewayModule({})).toThrow("token is required")
    expect(() => funnel.gatewayServer({ port: Number.NaN, token: "test" })).toThrow("port")
  })

  test("stopped gateways reject publication before it reaches subscribers", async () => {
    const funnel = new Funnel({ channels: [{ name: "ops" }] })
    const gateway = funnel.gatewayModule({ token: "test" })
    const received: string[] = []
    gateway.onEvent((event) => received.push(event.content))
    await gateway.stop()
    expect(() => gateway.emit({ channel: "ops", content: "late" })).toThrow("stopped")
    expect(received).toEqual([])
  })

  test("byte retention drops whole events without rolling back the replay offset", async () => {
    const funnel = new Funnel({ channels: [{ name: "ops" }] })
    const gateway = funnel.gatewayModule({ token: "test" })
    const body = "x".repeat(3 * 1024 * 1024)
    gateway.emit({ channel: "ops", content: body })
    gateway.emit({ channel: "ops", content: body })
    const retained = gateway.getEventLog().loadSince(0)
    expect(retained).toHaveLength(1)
    expect(retained[0]?.content).toBe(body)
    expect(retained[0]?.offset).toBe(2)
    gateway.emit({ channel: "ops", content: "x".repeat(5 * 1024 * 1024) })
    expect(gateway.getEventLog().loadSince(0)).toEqual([])
    expect(gateway.getEventLog().findMaxOffset()).toBe(3)
    await gateway.stop()
  })

  test("root imports no filesystem, SQLite, process runner, CLI or agent runtime", async () => {
    const seen = new Set<string>()
    const root = import.meta.dir
    const transpiler = new Bun.Transpiler({ loader: "ts" })
    const visit = async (path: string): Promise<void> => {
      if (seen.has(path)) return
      seen.add(path)
      const source = transpiler.transformSync(await Bun.file(path).text())
      for (const item of transpiler.scanImports(source)) {
        expect(item.path).not.toMatch(/^(?:node:(?:fs|child_process|os)|bun:sqlite)$/)
        expect(item.path).not.toMatch(
          /(?:^|\/)(?:cli|claude|profiles|process-runner|settings-store|sqlite)(?:\/|$)/,
        )
        const base = item.path.startsWith("@/")
          ? resolve(root, item.path.slice(2))
          : item.path.startsWith(".")
            ? resolve(dirname(path), item.path)
            : null
        if (base)
          await visit((await Bun.file(`${base}.ts`).exists()) ? `${base}.ts` : `${base}/index.ts`)
      }
      // Re-exports also form part of the public runtime graph.
      for (const match of source.matchAll(/from\s+["'](@\/[^"']+)["']/g)) {
        const base = resolve(root, match[1]!.slice(2))
        await visit((await Bun.file(`${base}.ts`).exists()) ? `${base}.ts` : `${base}/index.ts`)
      }
    }
    await visit(resolve(root, "index.ts"))
    const pkg = await Bun.file(resolve(root, "../package.json")).json()
    expect(pkg.bin).toBeUndefined()
  })

  test("default configuration is isolated in memory", () => {
    const first = new Funnel()
    first.channels.add({ name: "ops" })
    expect(new Funnel().channels.list()).toEqual([])
    expect("paths" in first).toBe(false)
    expect("claude" in first).toBe(false)
  })

  test("default replay is bounded memory and does not truncate delivered content", async () => {
    const funnel = new Funnel()
    funnel.channels.add({ name: "ops" })
    const gateway = funnel.gatewayModule({ token: "test-token" })
    const received: string[] = []
    gateway.onEvent((event) => received.push(event.content))
    for (let i = 0; i < 205; i++) gateway.emit({ channel: "ops", content: String(i) })
    expect(received).toHaveLength(205)
    expect(gateway.getEventLog()).toBeInstanceOf(MemoryFunnelEventLog)
    expect(gateway.getEventLog().loadSince(0)).toHaveLength(200)
    expect(gateway.getEventLog().findMaxOffset()).toBe(205)
    await gateway.stop()
  })

  test("host state survives listener recreation without a library directory", async () => {
    const funnel = new Funnel({ connectors: [scheduleConnector()] })
    funnel.channels.add({ name: "ops" })
    funnel.channels.addConnector("ops", {
      type: "schedule",
      name: "once",
      entries: [
        {
          id: "once",
          kind: "once",
          runAt: new Date(Date.now() - 120000).toISOString(),
          prompt: "hello",
          enabled: true,
        },
      ],
    })
    const gateway = funnel.gatewayModule({ token: "test-token" })
    const received: string[] = []
    gateway.onEvent((event) => received.push(event.content))
    await gateway.start()
    await gateway.getRegistry().restart("ops", "once")
    expect(received).toEqual(["hello"])
    await gateway.stop()
  })
})
