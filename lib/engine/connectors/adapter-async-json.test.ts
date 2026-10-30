import { expect, test } from "bun:test"
import { FunnelGhAdapter } from "@/engine/connectors/gh-adapter"
import { FunnelDiscordAdapter } from "@/engine/connectors/discord-adapter"
import { FunnelSlackAdapter } from "@/engine/connectors/slack-adapter"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"

for (const type of ["gh", "discord", "slack"] as const) {
  for (const kind of ["resolved", "rejected", "hidden-then", "thenable"] as const) {
    test(`${type} refuses ${kind} asynchronous JSON values before dispatch`, async () => {
      const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true}' }))
      const config = {
        id: "source",
        name: "source",
        type,
        token: "example-token",
        botToken: "example-token",
        minify: true,
      }
      const adapter =
        type === "gh"
          ? new FunnelGhAdapter({ config: { ...config, type }, http })
          : type === "discord"
            ? new FunnelDiscordAdapter({ config: { ...config, type }, http })
            : new FunnelSlackAdapter({ config: { ...config, type }, http })
      const bad = () => {
        if (kind === "thenable")
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- Exercise an asynchronous JSON value.
            then(_resolve: unknown, reject: (error: unknown) => void) {
              reject(new Error("serialization unavailable"))
            },
          }
        const value =
          kind === "resolved"
            ? Promise.resolve("later")
            : Promise.reject(new Error("serialization unavailable"))
        void value.catch(() => {})
        if (kind === "hidden-then") {
          // oxlint-disable-next-line unicorn/no-thenable -- Exercise a native promise with a hidden method.
          Object.defineProperty(value, "then", { value: undefined })
        }
        return value
      }
      for (const body of [
        bad(),
        { value: bad() },
        { nested: [{ value: bad() }] },
        {
          value: {
            toJSON() {
              return bad()
            },
          },
        },
      ]) {
        await expect(
          adapter.call({ method: "POST", path: "example", body: body as never }),
        ).rejects.toThrow("JSON body values must be synchronous")
        expect(http.calls).toHaveLength(0)
      }
      let conversions = 0
      const model = {
        value: "retained",
        toJSON() {
          conversions++
          return { value: this.value, special: Object.fromEntries([["__proto__", "retained"]]) }
        },
      }
      expect(
        await adapter.call({ method: "POST", path: "example", body: { value: model } as never }),
      ).toEqual({ ok: true })
      expect(conversions).toBe(1)
      expect(http.calls).toHaveLength(1)
      const output =
        type === "slack"
          ? { value: JSON.parse(new URLSearchParams(http.calls[0]!.body).get("value")!) }
          : JSON.parse(http.calls[0]!.body!)
      expect(output).toEqual({
        value: { value: "retained", special: Object.fromEntries([["__proto__", "retained"]]) },
      })
      await Bun.sleep(0)
    })
  }
}
