import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { HTTPException } from "hono/http-exception"

const connector: ConnectorDescriptor = {
  type: "source",
  toolExposed: false,
  operations: {},
  secretTokens: () => [],
  buildConfig: () => ({ id: "source", name: "source", type: "source" }),
  applyUpdate: (config) => config,
  createAdapter: null,
  createListener: () => ({
    async start() {},
    async stop() {},
    isAlive: () => true,
    isConnected: () => true,
  }),
}

const failures = [
  { name: "string", create: () => "host failure", message: "host failure" },
  {
    name: "null prototype",
    create: () => Object.create(null),
    message: "Unprintable thrown value",
  },
  {
    name: "revoked proxy",
    create: () => {
      const { proxy, revoke } = Proxy.revocable({}, {})
      revoke()
      return proxy
    },
    message: "Unprintable thrown value",
  },
]

async function expectFailure(request: Response | Promise<Response>, message: string) {
  const response = await Promise.resolve(request).catch(() => null)
  expect(response).not.toBeNull()
  expect(response!.status).toBe(500)
  expect(await response!.json()).toEqual({ error: message })
}

test("the shared HTTP boundary preserves an explicit HTTPException response", async () => {
  class EventLog extends MemoryFunnelEventLog {
    override record(): void {
      throw new HTTPException(409, {
        res: new Response('{"error":"conflict"}', {
          status: 409,
          headers: { "content-type": "application/json", "x-detail": "conflict" },
        }),
      })
    }
  }
  const gateway = new Funnel({ channels: [{ name: "channel" }] }).gatewayModule({
    token: "",
    eventLog: new EventLog(),
  })
  try {
    const response = await gateway.app.request("/channels/channel/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "input" }),
    })
    expect(response.status).toBe(409)
    expect(response.headers.get("x-detail")).toBe("conflict")
    expect(await response.json()).toEqual({ error: "conflict" })
  } finally {
    await gateway.stop()
  }
})

for (const fixture of failures) {
  test(`${fixture.name} persistence failures return JSON without publication`, async () => {
    const failure = fixture.create()
    class EventLog extends MemoryFunnelEventLog {
      override record(): void {
        throw failure
      }
    }
    const gateway = new Funnel({ channels: [{ name: "channel" }] }).gatewayModule({
      token: "",
      eventLog: new EventLog(),
    })
    let delivered = 0
    gateway.onEvent(() => {
      delivered++
    })
    try {
      await expectFailure(
        gateway.app.request("/channels/channel/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "input" }),
        }),
        fixture.message,
      )
      expect(delivered).toBe(0)
      expect(gateway.getBroadcaster().getMetrics().eventsBroadcast).toBe(0)
    } finally {
      await gateway.stop()
    }
  })

  test(`${fixture.name} diagnostic query failures return JSON`, async () => {
    const failure = fixture.create()
    class Diagnostics extends MemoryConnectorDiagnosticLog {
      override queryProcessed(): never {
        throw failure
      }
    }
    const gateway = new Funnel({
      channels: [{ name: "channel" }],
      diagnosticLog: new Diagnostics(),
    }).gatewayModule({ token: "" })
    try {
      await expectFailure(gateway.app.request("/debug"), fixture.message)
    } finally {
      await gateway.stop()
    }
  })

  for (const [method, path] of [
    ["GET", "/status"],
    ["GET", "/health"],
    ["GET", "/debug"],
    ["GET", "/listeners"],
    ["POST", "/listeners/channel/source/start"],
    ["POST", "/listeners/channel/source/restart"],
    ["DELETE", "/listeners/channel/source"],
  ] as const) {
    test(`${fixture.name} settings failures at ${method} ${path} return JSON`, async () => {
      const failure = fixture.create()
      let fail = false
      class Store extends MemoryFunnelSettingsStore {
        override read() {
          if (fail) throw failure
          return super.read()
        }
      }
      const gateway = new Funnel({
        connectors: [connector],
        store: new Store({
          channels: [
            {
              id: "channel",
              name: "channel",
              delivery: "fanout",
              connectors: [{ id: "source", name: "source", type: "source" }],
            },
          ],
        }),
      }).gatewayModule({ token: "" })
      try {
        await gateway.start()
        fail = true
        await expectFailure(gateway.app.request(path, { method }), fixture.message)
      } finally {
        fail = false
        await gateway.stop()
      }
    })
  }
}
