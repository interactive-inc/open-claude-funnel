import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelConnectorListener, type NotifyFn } from "@/engine/connectors/connector-listener"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"

test("server shutdown is visible to reentrant start and stop callbacks before cleanup", async () => {
  let restarting: Promise<void> | undefined
  let nestedStop: Promise<void> | undefined
  let stops = 0
  class Listener extends FunnelConnectorListener {
    async start(_notify: NotifyFn, signal?: AbortSignal) {
      signal?.addEventListener(
        "abort",
        () => {
          restarting = gateway.start()
          void restarting.catch(() => {})
          nestedStop = gateway.stop()
        },
        { once: true },
      )
    }
    async stop() {
      stops++
    }
  }
  const connector: ConnectorDescriptor = {
    type: "source",
    toolExposed: false,
    secretTokens: () => [],
    operations: {},
    createAdapter: null,
    buildConfig: (input, context) => ({ id: context.id, name: String(input.name), type: "source" }),
    applyUpdate: (config) => config,
    createListener: () => new Listener(),
  }
  const gateway = new Funnel({
    connectors: [connector],
    channels: [{ name: "channel", connectors: [{ name: "source", type: "source" }] }],
  }).gatewayServer({ port: 0, token: "" })
  try {
    await gateway.start()
    const stopping = gateway.stop()
    expect(nestedStop).toBe(stopping)
    expect(restarting).toBeInstanceOf(Promise)
    await expect(restarting!).rejects.toThrow("single-use")
    await stopping
    expect(stops).toBe(1)
    expect(gateway.getRegistry().list()).toEqual([])
  } finally {
    await gateway.stop()
  }
})
