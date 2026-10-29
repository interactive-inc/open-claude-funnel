import { expect, test } from "bun:test"
import { NodeFunnelHttpClient } from "@/engine/http/node-http-client"

test("HTTP cancellation interrupts a pending request before response headers", async () => {
  const received = Promise.withResolvers<void>()
  const reply = Promise.withResolvers<Response>()
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      received.resolve()
      return reply.promise
    },
  })
  const controller = new AbortController()
  const request = new NodeFunnelHttpClient().fetch({
    method: "GET",
    url: `http://127.0.0.1:${server.port}`,
    signal: controller.signal,
  })
  const deadline = Promise.withResolvers<never>()
  const timer = setTimeout(() => deadline.reject(new Error("request ignored cancellation")), 1000)
  try {
    await Promise.race([received.promise, deadline.promise])
    controller.abort(new Error("request cancelled"))
    await expect(Promise.race([request, deadline.promise])).rejects.toThrow("request cancelled")
  } finally {
    clearTimeout(timer)
    reply.resolve(new Response("released"))
    server.stop(true)
    await request.catch(() => {})
  }
})

test("HTTP cancellation interrupts response-body reads after headers", async () => {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("{"))
          },
        }),
      ),
  })
  const controller = new AbortController()
  const deadline = Promise.withResolvers<never>()
  const timer = setTimeout(() => deadline.reject(new Error("body ignored cancellation")), 1000)
  try {
    const response = await Promise.race([
      new NodeFunnelHttpClient().fetch({
        method: "GET",
        url: `http://127.0.0.1:${server.port}`,
        signal: controller.signal,
      }),
      deadline.promise,
    ])
    const body = response.text()
    controller.abort(new Error("body cancelled"))
    await expect(Promise.race([body, deadline.promise])).rejects.toThrow("body cancelled")
  } finally {
    clearTimeout(timer)
    server.stop(true)
  }
})
