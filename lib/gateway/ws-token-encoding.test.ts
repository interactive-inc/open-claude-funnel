import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { channelWsProtocols } from "@/gateway/channel-ws-url"

for (const token of [
  "example/token==",
  "example token",
  "example(token)",
  "example,token",
  "example-\u2603",
  "example%2Ftoken",
]) {
  test(`native WebSocket authenticates a token with reserved characters: ${token}`, async () => {
    const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayServer({ port: 0, token })
    await gateway.start()
    try {
      const script = `
        const ws = new WebSocket(process.argv[1], JSON.parse(process.argv[2]))
        const timer = setTimeout(() => { ws.close(); console.error("connection timed out"); process.exitCode = 1 }, 1000)
        ws.onopen = () => { clearTimeout(timer); console.log("connected"); ws.close() }
        ws.onerror = () => { clearTimeout(timer); console.error("connection failed"); process.exitCode = 1 }
      `
      const child = Bun.spawn(
        [
          "node",
          "--input-type=module",
          "-e",
          script,
          `ws://127.0.0.1:${gateway.port}/ws?channel=ops`,
          JSON.stringify(channelWsProtocols(token)),
        ],
        { stdout: "pipe", stderr: "pipe" },
      )
      const [output, errors, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      expect({ errors, exit }).toEqual({ errors: "", exit: 0 })
      expect(output.trim()).toBe("connected")
    } finally {
      await gateway.stop()
    }
  })
}

test("malformed or mismatched encoded protocols cannot authenticate or alias raw credentials", async () => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({
    token: "example/token==",
  })
  let upgrades = 0
  const server = {
    upgrade() {
      upgrades++
      return true
    },
  } as never
  const request = (protocol: string) =>
    new Request("http://localhost/ws?channel=ops", {
      headers: { upgrade: "websocket", "sec-websocket-protocol": protocol },
    })
  try {
    for (const protocol of [
      "funnel.token-uri.%",
      "funnel.token-uri.%GG",
      "funnel.token-uri.%FF",
      "funnel.token-uri.wrong%2Ftoken%3D%3D",
      "funnel.token.example%2Ftoken%3D%3D",
    ]) {
      const result = gateway.handleUpgrade(request(protocol), server)
      expect(result.handled).toBe(true)
      expect(result.response?.status).toBe(401)
    }
    expect(upgrades).toBe(0)
    expect(
      gateway.handleUpgrade(request(channelWsProtocols("example/token==")[0]!), server),
    ).toEqual({ handled: true, response: undefined })
    expect(upgrades).toBe(1)
  } finally {
    await gateway.stop()
  }
})
