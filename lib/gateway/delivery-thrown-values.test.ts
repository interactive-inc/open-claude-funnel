import { expect, test } from "bun:test"
import type { ServerWebSocket } from "bun"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { errorMessageOf } from "@/engine/error/error-message-of"

const failureFor = (kind: string): unknown => {
  if (kind === "null-prototype") return Object.create(null)
  if (kind === "revoked") {
    const revoked = Proxy.revocable({}, {})
    revoked.revoke()
    return revoked.proxy
  }
  const error = new Error()
  Object.defineProperty(error, "message", {
    get() {
      throw new Error("unreadable")
    },
  })
  return error
}

for (const kind of ["null-prototype", "revoked", "unreadable-error"] as const) {
  for (const phase of ["buffer", "send"] as const) {
    test(`${kind} ${phase} failures drop only the failed socket and preserve publication`, () => {
      const failure = failureFor(kind)
      const closed: number[] = []
      const sent: string[] = []
      const observed: string[] = []
      const recorded: number[] = []
      const logger = new MemoryFunnelLogger()
      const broadcaster = new FunnelBroadcaster({
        logger,
        record: (event) => {
          recorded.push(event.offset)
        },
      })
      const bad = {
        getBufferedAmount() {
          if (phase === "buffer") throw failure
          return 0
        },
        send() {
          throw failure
        },
        close(code: number) {
          closed.push(code)
        },
      } as unknown as ServerWebSocket<unknown>
      const good = {
        getBufferedAmount: () => 0,
        send(payload: string) {
          sent.push(JSON.parse(payload).content)
          return payload.length
        },
        close() {},
      } as unknown as ServerWebSocket<unknown>
      for (const socket of [bad, good])
        broadcaster.addClient(socket, { channel: "channel", connectors: [] })
      broadcaster.subscribe((event) => {
        observed.push(event.content)
      })
      try {
        expect(broadcaster.broadcast("input").offset).toBe(1)
        expect(broadcaster.broadcast("next").offset).toBe(2)
        expect(closed).toEqual([1011])
        expect(sent).toEqual(["input", "next"])
        expect(observed).toEqual(sent)
        expect(recorded).toEqual([1, 2])
        expect(broadcaster.getClientCount()).toBe(1)
        expect(logger.entries.filter((entry) => entry.level === "warn")).toMatchObject([
          {
            message: "ws.send failed; dropping client",
            meta: { error: "Unprintable thrown value" },
          },
        ])
      } finally {
        broadcaster.closeClients()
      }
    })
  }

  test(`${kind} observer failures reach the host reporter without blocking later observers`, () => {
    const failure = failureFor(kind)
    const reports: Error[] = []
    const observed: string[] = []
    const broadcaster = new FunnelBroadcaster({
      onError: (error) => {
        reports.push(error)
      },
    })
    broadcaster.subscribe(() => {
      throw failure
    })
    broadcaster.subscribe((event) => {
      observed.push(event.content)
    })
    broadcaster.broadcast("input")
    expect(observed).toEqual(["input"])
    expect(reports).toHaveLength(1)
    expect(errorMessageOf(reports[0])).toBe("Unprintable thrown value")
    broadcaster.closeObservers()
  })
}
