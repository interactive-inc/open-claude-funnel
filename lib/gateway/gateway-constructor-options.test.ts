import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { FunnelGatewayModule } from "@/gateway/gateway-module"
import { FunnelGatewayServer } from "@/gateway/gateway-server"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"

for (const kind of ["module", "server"] as const) {
  test(`${kind} uses one captured token for configuration and HTTP authentication`, async () => {
    const funnel = new Funnel({ channels: [{ name: "channel" }] })
    let reads = 0
    const input = {
      channels: funnel.channels,
      port: 0,
      get token() {
        return ++reads === 1 ? "example-token" : ""
      },
    }
    const gateway =
      kind === "module" ? new FunnelGatewayModule(input) : new FunnelGatewayServer(input)
    try {
      await gateway.start()
      const request = (headers?: Record<string, string>) =>
        "getModule" in gateway
          ? fetch(`http://127.0.0.1:${gateway.port}/status`, { headers })
          : gateway.app.request("/status", { headers })
      expect((await request()).status).toBe(401)
      expect((await request({ authorization: "Bearer example-token" })).status).toBe(200)
      expect(reads).toBe(1)
    } finally {
      await gateway.stop()
    }
  })
}

test("gateway storage selection and ownership use the same captured host log", async () => {
  let closed = 0
  let reads = 0
  class HostLog extends MemoryFunnelEventLog {
    override close() {
      closed++
    }
  }
  const host = new HostLog()
  const gateway = new FunnelGatewayModule({
    channels: new Funnel({ channels: [{ name: "channel" }] }).channels,
    token: "",
    get eventLog() {
      return ++reads === 1 ? host : undefined
    },
  })
  try {
    gateway.emit({ channel: "channel", content: "input" })
    await gateway.stop()
    expect(reads).toBe(1)
    expect(closed).toBe(0)
    expect(host.loadSince(0).map((event) => event.content)).toEqual(["input"])
  } finally {
    await gateway.stop()
    host.close()
  }
})
