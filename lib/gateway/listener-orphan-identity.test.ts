import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"

const setup = async () => {
  const stopped: string[] = []
  class Listener extends FunnelConnectorListener {
    constructor(private readonly id: string) {
      super()
    }
    async start() {}
    async stop() {
      stopped.push(this.id)
    }
  }
  const descriptor: ConnectorDescriptor = {
    type: "test",
    toolExposed: false,
    operations: {},
    createAdapter: null,
    secretTokens: () => [],
    buildConfig: (input, context) => ({ id: context.id, name: String(input.name), type: "test" }),
    applyUpdate: (config) => config,
    createListener: (config) => new Listener(config.id),
  }
  const funnel = new Funnel({
    connectors: [descriptor],
    channels: [{ name: "ops", connectors: [{ name: "source", type: "test" }] }],
  })
  const gateway = funnel.gatewayModule({ token: "" })
  const registry = gateway.getRegistry()
  const first = funnel.channels.getConnector("ops", "source")!.id
  await registry.start("ops", "source")
  funnel.channels.renameConnector("ops", "source", "renamed")
  const second = funnel.channels.addConnector("ops", { name: "source", type: "test" }).id
  await registry.start("ops", "source")
  return { funnel, gateway, registry, first, second, stopped }
}

for (const operation of ["stop", "restart"] as const) {
  test(`${operation} rejects ambiguous detached names without choosing an old connection`, async () => {
    const context = await setup()
    try {
      context.funnel.channels.remove("ops")
      await expect(context.registry[operation]("ops", "source")).rejects.toThrow(
        "listener name is ambiguous among detached connections",
      )
      expect(context.stopped).toEqual([])
      expect(context.registry.list().map((entry) => entry.name)).toEqual(["source", "source"])
      await context.registry.stopAll()
      expect(context.stopped.sort()).toEqual([context.first, context.second].sort())
    } finally {
      await context.gateway.stop()
    }
  })
}

test("configured identity takes priority and a unique orphan can still be stopped", async () => {
  const context = await setup()
  try {
    expect(await context.registry.stop("ops", "source")).toEqual({ ok: true })
    expect(context.stopped).toEqual([context.second])
    context.funnel.channels.remove("ops")
    expect(await context.registry.stop("ops", "source")).toEqual({ ok: true })
    expect(context.stopped).toEqual([context.second, context.first])
    expect(context.registry.list()).toEqual([])
  } finally {
    await context.gateway.stop()
  }
})
