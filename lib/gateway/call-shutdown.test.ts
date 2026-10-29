import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { FunnelSettingsReader } from "@/engine/settings/settings-reader"
import type { Settings } from "@/engine/settings/settings-schema"
import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"

class Store extends FunnelSettingsReader {
  onRead: (() => void) | undefined
  state: Settings = {
    channels: [
      {
        id: "ops",
        name: "ops",
        delivery: "fanout",
        connectors: [{ id: "source", name: "source", type: "test" }],
      },
    ],
  }
  read() {
    const callback = this.onRead
    this.onRead = undefined
    callback?.()
    return this.state
  }
  write(settings: Settings) {
    this.state = settings
  }
  update<T>(mutator: (settings: Settings) => T): T {
    return mutator(this.state)
  }
}

const descriptorFor = (
  createAdapter: ConnectorDescriptor["createAdapter"],
): ConnectorDescriptor => ({
  type: "test",
  toolExposed: true,
  operations: {},
  secretTokens: () => [],
  createListener: () => {
    throw new Error("Unused listener")
  },
  buildConfig: () => {
    throw new Error("Unused builder")
  },
  applyUpdate: (config) => config,
  createAdapter,
})

for (const phase of ["lookup", "adapter"] as const) {
  test(`shutdown during call ${phase} prevents external dispatch`, async () => {
    const store = new Store()
    let stop: (() => void) | undefined
    let calls = 0
    const descriptor: ConnectorDescriptor = {
      type: "test",
      toolExposed: true,
      operations: {},
      secretTokens: () => [],
      createListener: () => {
        throw new Error("Unused listener")
      },
      buildConfig: () => {
        throw new Error("Unused builder")
      },
      applyUpdate: (config) => config,
      createAdapter: () => {
        if (phase === "adapter") stop?.()
        return {
          call: async () => {
            calls++
            return null
          },
        }
      },
    }
    const gateway = new Funnel({ store, connectors: [descriptor] }).gatewayModule({ token: "" })
    stop = () => {
      void gateway.stop()
    }
    if (phase === "lookup") store.onRead = stop
    try {
      const response = await gateway.app.request("/channels/ops/connectors/source/call", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ method: "POST", path: "send" }),
      })
      expect(response.status).toBe(503)
      expect(calls).toBe(0)
    } finally {
      await gateway.stop()
    }
  })
}

for (const action of ["stop", "dispose", "host-abort", "request-abort"] as const) {
  test(`${action} cancels an in-flight HTTP connector call`, async () => {
    const entered = Promise.withResolvers<void>()
    let signal: AbortSignal | undefined
    const descriptor = descriptorFor(() => ({
      call: async (input) => {
        signal = input.signal
        entered.resolve()
        if (!signal) throw new Error("Missing call cancellation signal")
        signal.throwIfAborted()
        return await new Promise((_, reject) => {
          signal!.addEventListener("abort", () => reject(signal!.reason), { once: true })
        })
      },
    }))
    const host = new AbortController()
    const request = new AbortController()
    const gateway = new Funnel({
      store: new Store(),
      connectors: [descriptor],
      signal: host.signal,
    }).gatewayModule({ token: "" })
    const response = gateway.app.request("/channels/ops/connectors/source/call", {
      method: "POST",
      signal: request.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ method: "POST", path: "send" }),
    })
    try {
      await entered.promise
      if (action === "stop") await gateway.stop()
      else if (action === "dispose") gateway.dispose()
      else if (action === "host-abort") host.abort()
      else request.abort()
      expect(signal?.aborted).toBe(true)
      const result = await response
      expect(action === "request-abort" ? result.status >= 400 : result.status === 503).toBe(true)
    } finally {
      await gateway.stop()
    }
  })
}

test("a custom adapter's late success after shutdown is rejected", async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const descriptor = descriptorFor(() => ({
    call: async () => {
      entered.resolve()
      await release.promise
      return "late success"
    },
  }))
  const gateway = new Funnel({ store: new Store(), connectors: [descriptor] }).gatewayModule({
    token: "",
  })
  const response = gateway.app.request("/channels/ops/connectors/source/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "POST", path: "send" }),
  })
  try {
    await entered.promise
    await gateway.stop()
    release.resolve()
    expect((await response).status).toBe(503)
  } finally {
    release.resolve()
    await gateway.stop()
  }
})

test("gateway shutdown interrupts a connector reading a real local HTTP response body", async () => {
  const reading = Promise.withResolvers<void>()
  const backend = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"))
          },
        }),
      ),
  })
  const native = new NodeFunnelHttpClient()
  const descriptor = descriptorFor(
    () =>
      new FunnelGhAdapter({
        config: { id: "source", name: "source", type: "gh", token: "example-token" },
        http: {
          fetch: async (request) => {
            const response = await native.fetch({
              ...request,
              url: `http://127.0.0.1:${backend.port}`,
            })
            return {
              ...response,
              json: () => {
                reading.resolve()
                return response.json()
              },
            }
          },
        },
      }),
  )
  const gateway = new Funnel({ store: new Store(), connectors: [descriptor] }).gatewayModule({
    token: "",
  })
  const deadline = Promise.withResolvers<never>()
  const timer = setTimeout(
    () => deadline.reject(new Error("connector call ignored cancellation")),
    1000,
  )
  const response = gateway.app.request("/channels/ops/connectors/source/call", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method: "POST", path: "send" }),
  })
  try {
    await Promise.race([reading.promise, deadline.promise])
    await gateway.stop()
    expect((await Promise.race([response, deadline.promise])).status).toBe(503)
  } finally {
    clearTimeout(timer)
    await gateway.stop()
    backend.stop(true)
  }
})
