import { expect, test } from "bun:test"
import type { ServerWebSocket } from "bun"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"

const socket = (onSend?: () => void, dropped = false) => {
  const sent: string[] = []
  const ws = {
    getBufferedAmount: () => 0,
    close: () => {},
    send(payload: string) {
      onSend?.()
      if (dropped) return 0
      sent.push(JSON.parse(payload).content)
      return payload.length
    },
  } as unknown as ServerWebSocket<unknown>
  return { ws, sent }
}

for (const phase of ["record", "send", "logger"] as const) {
  for (const readd of [false, true]) {
    test(`a socket removed during ${phase} cannot receive through its ${readd ? "replaced" : "removed"} registration`, () => {
      const target = socket()
      const healthy = socket()
      let detached = false
      const detach = () => {
        if (detached) return
        detached = true
        broadcaster.removeClient(target.ws)
        if (readd) broadcaster.addClient(target.ws, { channel: "other", connectors: [] })
      }
      class Logger extends MemoryFunnelLogger {
        override warn() {
          if (phase === "logger") detach()
        }
      }
      const broadcaster = new FunnelBroadcaster({
        logger: new Logger(),
        record: () => {
          if (phase === "record") detach()
        },
      })
      const first = socket(() => {
        if (phase === "send") detach()
      }, phase === "logger")
      for (const ws of [first.ws, target.ws, healthy.ws])
        broadcaster.addClient(ws, { channel: "ops", connectors: [] })
      broadcaster.broadcast("original", { channelId: "ops" })
      expect(target.sent).toEqual([])
      expect(healthy.sent).toEqual(["original"])
      broadcaster.broadcast("next", { channelId: "other" })
      expect(target.sent).toEqual(readd ? ["next"] : [])
    })
  }
}

test("closing all clients during a send prevents later sends from the captured recipient list", () => {
  const broadcaster = new FunnelBroadcaster()
  const first = socket(() => broadcaster.closeClients())
  const second = socket()
  for (const ws of [first.ws, second.ws])
    broadcaster.addClient(ws, { channel: "ops", connectors: [] })
  broadcaster.broadcast("original")
  expect(first.sent).toEqual(["original"])
  expect(second.sent).toEqual([])
  expect(broadcaster.getClientCount()).toBe(0)
})
