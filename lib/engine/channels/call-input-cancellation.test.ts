import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { discordConnector } from "@/engine/connectors/discord-connector"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"

for (const phase of ["before", "method", "path", "body", "none"] as const) {
  test(`channel calls respect cancellation during input ${phase}`, async () => {
    const http = new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true}' }))
    const funnel = new Funnel({
      http,
      connectors: [discordConnector()],
      channels: [
        {
          name: "ops",
          connectors: [{ name: "source", type: "discord", botToken: "example-token" }],
        },
      ],
    })
    const controller = new AbortController()
    const reason = new Error("call cancelled")
    const reads: string[] = []
    const read = (name: string) => {
      reads.push(name)
      if (controller.signal.aborted) throw new Error("input accessed after cancellation")
      if (phase === name) controller.abort(reason)
    }
    if (phase === "before") controller.abort(reason)
    const result = funnel.channels.call("ops", "source", {
      get signal() {
        reads.push("signal")
        return controller.signal
      },
      get method() {
        read("method")
        return "POST"
      },
      get path() {
        read("path")
        return "messages"
      },
      get body() {
        read("body")
        return { content: "input" }
      },
    })
    if (phase === "none") {
      expect(await result).toEqual({ ok: true })
      expect(http.calls).toHaveLength(1)
      expect(http.calls[0]?.signal).toBe(controller.signal)
      expect(http.calls[0]?.body).toBe('{"content":"input"}')
      expect(reads.toSorted()).toEqual(["body", "method", "path", "signal"])
    } else {
      await expect(result).rejects.toBe(reason)
      expect(http.calls).toHaveLength(0)
      expect(reads).toEqual([
        "signal",
        ...(phase === "before"
          ? []
          : phase === "method"
            ? ["method"]
            : phase === "path"
              ? ["method", "path"]
              : ["method", "path", "body"]),
      ])
    }
  })
}
