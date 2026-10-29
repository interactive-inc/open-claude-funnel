import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import type { GatewayWsData } from "@/gateway/gateway-module"

for (const action of ["dispose", "stop", "abort", "socket-close"] as const) {
  for (const phase of ["load", "load-error", "claim", "send"] as const) {
    test(`${action} during WebSocket replay ${phase} closes without further sends or claims`, async () => {
      const controller = new AbortController()
      const failures: Error[] = []
      const funnel = new Funnel({
        signal: controller.signal,
        channels: [{ name: "ops", delivery: "exclusive" }],
        onError: (error) => {
          failures.push(error)
        },
      })
      const channelId = funnel.channels.get("ops")!.id
      const store = new MemoryFunnelEventLog()
      for (const offset of [1, 2])
        store.record({
          offset,
          content: `history-${offset}`,
          meta: { channelId },
          channelId,
          connectorId: null,
          exclusive: { [channelId]: null },
        })
      const gateway = funnel.gatewayModule({ token: "", eventLog: store })
      let stopping: Promise<void> | undefined
      let closeSocket: () => void = () => {
        throw new Error("socket has not opened")
      }
      const shutdown = () => {
        if (action === "dispose") gateway.dispose()
        else if (action === "stop") stopping = gateway.stop()
        else if (action === "abort") controller.abort()
        else closeSocket()
      }
      const load = store.loadSince.bind(store)
      store.loadSince = (since, limit) => {
        if (phase === "load" || phase === "load-error") shutdown()
        if (phase === "load-error") throw new Error("read failed after cancellation")
        return load(since, limit)
      }
      const closeRequests: { code: number | undefined; reason: string | undefined }[] = []
      let claims = 0
      store.claimExclusive = () => {
        claims++
        if (phase === "claim") shutdown()
        return true
      }
      const server = Bun.serve<GatewayWsData>({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request, host) {
          const upgrade = gateway.handleUpgrade(request, host)
          return upgrade.handled ? upgrade.response : new Response("not found", { status: 404 })
        },
        websocket: {
          ...gateway.websocket,
          open(socket) {
            const close = socket.close.bind(socket)
            socket.close = (code, reason) => {
              closeRequests.push({ code, reason })
              close(code, reason)
            }
            closeSocket = () => socket.close(1000, "host closed")
            if (phase === "send") {
              const send = socket.send.bind(socket)
              socket.send = (payload, compress) => {
                const result = send(payload, compress)
                shutdown()
                return result
              }
            }
            gateway.websocket.open?.(socket)
          },
        },
      })
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws?channel=ops&id=worker&since=0`)
      const messages: string[] = []
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const closed = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
          timer = setTimeout(() => reject(new Error("shutdown left replay socket open")), 1000)
          socket.onmessage = (event) => {
            messages.push(String(event.data))
          }
          socket.onerror = () => reject(new Error("handshake failed"))
          socket.onclose = (event) => resolve({ code: event.code, reason: event.reason })
        })
        await stopping
        const reason = action === "socket-close" ? "host closed" : "gateway stopped"
        expect(closeRequests).toEqual([{ code: action === "socket-close" ? 1000 : 1001, reason }])
        // Bun loopback currently reports a requested 1001 closure as 1000.
        expect([1000, 1001]).toContain(closed.code)
        expect(closed.reason).toBe(reason)
        expect(messages).toHaveLength(phase === "send" ? 1 : 0)
        expect(claims).toBe(phase === "load" || phase === "load-error" ? 0 : 1)
        expect(gateway.getStatus().clients).toBe(0)
        expect(failures).toEqual([])
      } finally {
        clearTimeout(timer)
        socket.close()
        await gateway.stop()
        server.stop(true)
        store.close()
      }
    })
  }
}
