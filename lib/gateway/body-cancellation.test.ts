import { Hono } from "hono"
import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"

for (const path of ["/channels/ops/publish", "/channels/ops/connectors/source/call"]) {
  for (const action of ["stop", "dispose", "request-abort"] as const) {
    test(`${action} cancels an unfinished request body on ${path}`, async () => {
      const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
      const controller = new AbortController()
      const reading = Promise.withResolvers<void>()
      let canceled = false
      let pulls = 0
      const body = new ReadableStream<Uint8Array>(
        {
          pull(stream) {
            if (pulls++ === 0) stream.enqueue(new TextEncoder().encode("{"))
            else reading.resolve()
          },
          cancel() {
            canceled = true
          },
        },
        { highWaterMark: 0 },
      )
      const response = gateway.app.request(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: controller.signal,
      })
      const deadline = setTimeout(() => controller.abort(), 1000)
      try {
        await reading.promise
        if (action === "stop") void gateway.stop()
        else if (action === "dispose") gateway.dispose()
        else controller.abort()
        const result = await Promise.race([response, Bun.sleep(50).then(() => null)])
        expect(result).not.toBeNull()
        expect(result?.status).toBe(action === "request-abort" ? 400 : 503)
        expect(canceled).toBe(true)
        expect(gateway.getBroadcaster().getMetrics().eventsBroadcast).toBe(0)
      } finally {
        clearTimeout(deadline)
        controller.abort()
        await gateway.stop()
      }
    })
  }
}

test("streamed UTF-8 and a host-cached JSON body remain readable by route validators", async () => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
  const app = new Hono()
    .use(async (c, next) => {
      await c.req.json()
      await next()
    })
    .route("/", gateway.app)
  try {
    const bytes = new TextEncoder().encode(JSON.stringify({ content: "あいう" }))
    let index = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index === bytes.length) controller.close()
        else controller.enqueue(bytes.slice(index, ++index))
      },
    })
    const streamed = await gateway.app.request("/channels/ops/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    })
    expect(streamed.status).toBe(200)
    const cached = await app.request("/channels/ops/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "cached" }),
    })
    expect(cached.status).toBe(200)
    expect(
      gateway
        .getEventLog()
        .loadSince(0)
        .map((event) => event.content),
    ).toEqual(["あいう", "cached"])
  } finally {
    await gateway.stop()
  }
})
