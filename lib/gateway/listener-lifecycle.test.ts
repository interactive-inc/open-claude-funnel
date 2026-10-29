import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"

test("authenticated HTTP stop supersedes an earlier pending restart", async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const stopRequested = Promise.withResolvers<void>()
  class ControlledListener extends FunnelConnectorListener {
    alive = false
    async start(): Promise<void> {
      this.alive = true
    }
    async stop(): Promise<void> {
      entered.resolve()
      await release.promise
      this.alive = false
    }
    override isAlive(): boolean {
      return this.alive
    }
  }
  const listeners: ControlledListener[] = []
  const connector: ConnectorDescriptor = {
    type: "test",
    toolExposed: false,
    createAdapter: null,
    secretTokens: () => [],
    operations: {},
    buildConfig: (input, context) => ({ id: context.id, name: String(input.name), type: "test" }),
    applyUpdate: (config) => config,
    createListener: () => {
      const listener = new ControlledListener()
      listeners.push(listener)
      return listener
    },
  }
  const gateway = new Funnel({
    connectors: [connector],
    channels: [{ name: "ops", connectors: [{ type: "test", name: "events" }] }],
  }).gatewayModule({ token: "example-token" })
  const registry = gateway.getRegistry()
  const originalStop = registry.stop.bind(registry)
  registry.stop = (channel, name) => {
    const stopping = originalStop(channel, name)
    stopRequested.resolve()
    return stopping
  }
  try {
    await gateway.start()
    const restarting = gateway.app.request("/listeners/ops/events/restart", {
      method: "POST",
      headers: { authorization: "Bearer example-token" },
    })
    await entered.promise
    const stopping = gateway.app.request("/listeners/ops/events", {
      method: "DELETE",
      headers: { authorization: "Bearer example-token" },
    })
    await stopRequested.promise
    release.resolve()
    const restartResponse = await restarting
    expect(restartResponse.status).toBe(400)
    expect(await restartResponse.json()).toMatchObject({ ok: false })
    expect((await stopping).status).toBe(200)
    expect(listeners).toHaveLength(1)
    expect(listeners[0]?.alive).toBe(false)
    expect(registry.list()).toEqual([])
  } finally {
    release.resolve()
    await gateway.stop()
  }
})
