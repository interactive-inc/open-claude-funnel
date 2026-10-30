import { expect, test } from "bun:test"
import { runInNewContext } from "node:vm"
import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { FunnelDiscordAdapter } from "@/engine/connectors/discord-adapter"
import { FunnelSlackAdapter } from "@/engine/connectors/slack-adapter"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"
import type { JsonValue } from "@/engine/connectors/connector-adapter"

for (const type of ["gh", "discord", "slack"] as const) {
  test(`${type} refuses non-finite JSON numbers before sending external requests`, async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true}' }))
    const adapter =
      type === "gh"
        ? new FunnelGhAdapter({
            config: { id: "source", name: "source", type, token: "example-token" },
            http,
          })
        : type === "discord"
          ? new FunnelDiscordAdapter({
              config: { id: "source", name: "source", type, botToken: "example-token" },
              http,
            })
          : new FunnelSlackAdapter({
              config: {
                id: "source",
                name: "source",
                type,
                botToken: "example-token",
                appToken: "example-app-token",
                minify: true,
              },
              http,
            })
    for (const numeric of [NaN, Infinity, -Infinity]) {
      for (const value of [
        numeric,
        Object(numeric),
        runInNewContext("Object(input)", { input: numeric }),
      ]) {
        const bodies: JsonValue[] = [{ value }, { nested: [{ value }] }]
        for (const body of bodies) {
          await expect(adapter.call({ method: "POST", path: "example", body })).rejects.toThrow(
            "JSON body numbers must be finite",
          )
          expect(http.calls).toHaveLength(0)
        }
        if (type !== "slack")
          await expect(
            adapter.call({ method: "POST", path: "example", body: value }),
          ).rejects.toThrow("JSON body numbers must be finite")
      }
    }
    const body = { value: Object(0), nested: [1, Object(-2.5), Number.MAX_VALUE, null] }
    expect(await adapter.call({ method: "POST", path: "example", body })).toEqual({ ok: true })
    expect(http.calls).toHaveLength(1)
    if (type === "slack") {
      const form = new URLSearchParams(http.calls[0]!.body)
      expect(form.get("value")).toBe("0")
      expect(JSON.parse(form.get("nested")!)).toEqual([1, -2.5, Number.MAX_VALUE, null])
    } else expect(http.calls[0]?.body).toBe(JSON.stringify(body))

    let coercions = 0
    let converted = 7
    const boxed = Object(NaN)
    boxed[Symbol.toPrimitive] = () => {
      coercions++
      return converted
    }
    expect(await adapter.call({ method: "POST", path: "example", body: { value: boxed } })).toEqual(
      { ok: true },
    )
    expect(coercions).toBe(1)
    expect(http.calls).toHaveLength(2)
    expect(
      type === "slack"
        ? new URLSearchParams(http.calls[1]!.body).get("value")
        : http.calls[1]?.body,
    ).toBe(type === "slack" ? "7" : '{"value":7}')
    converted = Infinity
    await expect(
      adapter.call({ method: "POST", path: "example", body: { value: boxed } }),
    ).rejects.toThrow("JSON body numbers must be finite")
    expect(coercions).toBe(2)
    expect(http.calls).toHaveLength(2)
  })
}
