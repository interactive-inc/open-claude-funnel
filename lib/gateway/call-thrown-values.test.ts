import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"

const fixtures = [
  { name: "string", create: () => "original failure", message: "original failure" },
  { name: "null", create: () => null, message: "null" },
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
  {
    name: "throwing Error message",
    create: () =>
      Object.defineProperty(new Error(), "message", {
        get() {
          throw new Error("message unavailable")
        },
      }),
    message: "Unprintable thrown value",
  },
]

for (const phase of ["factory", "call"] as const) {
  for (const fixture of fixtures) {
    test(`${fixture.name} failures during adapter ${phase} retain the HTTP JSON error contract`, async () => {
      const failure = fixture.create()
      const descriptor: ConnectorDescriptor = {
        type: "source",
        toolExposed: true,
        operations: {},
        secretTokens: () => [],
        buildConfig: (input, context) => ({
          ...input,
          id: context.id,
          type: "source",
          name: "input",
        }),
        applyUpdate: (config) => config,
        createListener() {
          throw new Error("unused listener")
        },
        createAdapter() {
          if (phase === "factory") throw failure
          return {
            async call() {
              throw failure
            },
          }
        },
      }
      const gateway = new Funnel({
        connectors: [descriptor],
        channels: [{ name: "channel", connectors: [{ type: "source", name: "input" }] }],
      }).gatewayModule({ token: "" })
      try {
        const response = await Promise.resolve(
          gateway.app.request("/channels/channel/connectors/input/call", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ method: "POST", path: "send" }),
          }),
        ).catch(() => null)
        expect(response).not.toBeNull()
        expect(response!.status).toBe(500)
        expect(response!.headers.get("content-type")).toContain("application/json")
        expect(await response!.json()).toEqual({ error: fixture.message })
      } finally {
        await gateway.stop()
      }
    })
  }
}
