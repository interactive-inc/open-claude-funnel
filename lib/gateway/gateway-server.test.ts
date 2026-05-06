import { afterEach, describe, expect, test } from "bun:test"
import type { Server } from "bun"
import { Funnel } from "@/funnel"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { NoopFunnelLogger } from "@/engine/logger/noop-logger"

const startServer = async (token: string) => {
  const fs = new MemoryFunnelFileSystem()
  const funnel = new Funnel({
    fs,
    logger: new NoopFunnelLogger(),
    dir: "/funnel",
    tmpDir: "/tmp/funnel-test",
  })
  const server = funnel.gatewayServer({
    port: 0,
    killCompetingSlack: false,
    token,
    logDir: "/tmp/funnel-test/events",
  })

  const httpServer = await server.start()
  return { server, httpServer }
}

let active: { server: { stop: () => Promise<void> }; httpServer: Server<unknown> } | null = null

afterEach(async () => {
  if (active) {
    await active.server.stop()
    active = null
  }
})

describe("FunnelGatewayServer auth integration", () => {
  test("/status returns 401 without bearer token", async () => {
    active = await startServer("secret-1")
    const url = `http://localhost:${active.httpServer.port}/status`
    const res = await fetch(url)

    expect(res.status).toBe(401)
  })

  test("/status returns 200 with the correct bearer token", async () => {
    active = await startServer("secret-2")
    const url = `http://localhost:${active.httpServer.port}/status`
    const res = await fetch(url, {
      headers: { authorization: "Bearer secret-2" },
    })

    expect(res.status).toBe(200)
  })

  test("/status returns 401 with the wrong bearer token", async () => {
    active = await startServer("secret-3")
    const url = `http://localhost:${active.httpServer.port}/status`
    const res = await fetch(url, {
      headers: { authorization: "Bearer nope" },
    })

    expect(res.status).toBe(401)
  })

  test("/health stays open without a token", async () => {
    active = await startServer("secret-4")
    const url = `http://localhost:${active.httpServer.port}/health`
    const res = await fetch(url)

    expect(res.status).toBe(200)
  })

  test("/listeners returns 401 without bearer token", async () => {
    active = await startServer("secret-5")
    const url = `http://localhost:${active.httpServer.port}/listeners`
    const res = await fetch(url)

    expect(res.status).toBe(401)
  })

  test("/ws upgrade is rejected without the sub-protocol or bearer header", async () => {
    active = await startServer("secret-6")
    const url = `http://localhost:${active.httpServer.port}/ws`
    const res = await fetch(url, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    })

    expect(res.status).toBe(401)
  })

  test("/ws upgrade succeeds with the funnel.token sub-protocol", async () => {
    active = await startServer("secret-7")
    const url = `ws://localhost:${active.httpServer.port}/ws?tap=all`

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url, ["funnel.token.secret-7"])
      const timeout = setTimeout(() => {
        ws.close()
        reject(new Error("timeout"))
      }, 1000)

      ws.addEventListener("open", () => {
        clearTimeout(timeout)
        ws.close()
        resolve()
      })
      ws.addEventListener("error", (event) => {
        clearTimeout(timeout)
        reject(event instanceof Error ? event : new Error("ws error"))
      })
    })
  })

  test("/ws upgrade is rejected with the wrong token in sub-protocol", async () => {
    active = await startServer("secret-8")
    const url = `http://localhost:${active.httpServer.port}/ws`
    const res = await fetch(url, {
      headers: {
        upgrade: "websocket",
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
        "sec-websocket-protocol": "funnel.token.bad",
      },
    })

    expect(res.status).toBe(401)
  })
})
