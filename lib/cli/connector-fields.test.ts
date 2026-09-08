import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { routes } from "@/cli/routes"
import { Funnel } from "@/funnel"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { baseConnectorConfigSchema } from "@/engine/connectors/base-connector-config"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import { connectorFieldsSchema } from "@/cli/connector-fields"
import { scheduleConnector } from "@/engine/connectors/schedule-connector"

const schema = baseConnectorConfigSchema.extend({ endpoint: z.string().url() })
class CustomListener extends FunnelConnectorListener {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
const custom: ConnectorDescriptor = {
  type: "custom",
  toolExposed: false,
  createAdapter: null,
  operations: {},
  secretTokens: () => [],
  createListener: () => new CustomListener(),
  buildConfig: (input, context) => schema.parse({ ...input, id: context.id }),
  applyUpdate: (config, fields) => schema.parse({ ...config, ...fields }),
}

describe("connector CLI delegates to descriptors", () => {
  test("adds and updates an injected connector without a CLI type branch", async () => {
    const funnel = new Funnel({
      fs: new MemoryFunnelFileSystem(),
      dir: "/funnel",
      connectors: [custom],
    })
    funnel.channels.add({ name: "ops" })
    const add = await routes.request(
      "/channels/ops/connectors/add/inbox?type=custom&endpoint=https://example.com/first",
      { method: "POST" },
      { funnel },
    )
    expect(add.status).toBe(200)
    const update = await routes.request(
      "/channels/ops/connectors/set/inbox?endpoint=https://example.com/next",
      { method: "POST" },
      { funnel },
    )
    expect(update.status).toBe(200)
    expect(schema.parse(funnel.channels.getConnector("ops", "inbox")).endpoint).toBe(
      "https://example.com/next",
    )
    const invalid = await routes.request(
      "/channels/ops/connectors/set/inbox?endpoint=invalid",
      { method: "POST" },
      { funnel },
    )
    expect(invalid.status).toBe(400)
    expect(schema.parse(funnel.channels.getConnector("ops", "inbox")).endpoint).toBe(
      "https://example.com/next",
    )
    expect(await funnel.listeners.list()).toEqual({ state: "offline" })
  })
  test("normalizes built-in flag spellings and preserves custom fields", () => {
    expect(
      connectorFieldsSchema.parse({ "bot-token": "token", "poll-interval": "10", custom: "value" }),
    ).toEqual({ botToken: "token", pollInterval: 10, custom: "value" })
    expect(connectorFieldsSchema.safeParse({ "poll-interval": "0" }).success).toBe(false)
  })
  test("schedule rejects field updates at the descriptor boundary", () => {
    expect(() =>
      scheduleConnector().applyUpdate(
        { id: "s", name: "s", type: "schedule" },
        {},
        { now: new Date().toISOString() },
      ),
    ).toThrow("no settable fields")
  })
})
