import { expect, test } from "vitest"
import { sendWebSocketPayload } from "@/gateway/send-websocket-payload"
import { closeFailedWebSocket } from "@/gateway/close-failed-websocket"

test.each([-1, 12])("accepts an enqueued WebSocket payload (%i)", (accepted) => {
  expect(() => sendWebSocketPayload({ send: () => accepted }, "event")).not.toThrow()
})
test("distinguishes a dropped event from a successful empty frame", () => {
  expect(() => sendWebSocketPayload({ send: () => 0 }, "event")).toThrow("dropped")
  expect(() => sendWebSocketPayload({ send: () => 0 }, "")).not.toThrow()
})
test("preserves send and close errors together for the host", () => {
  const send = new Error("send failed")
  const close = new Error("close failed")
  const failure = closeFailedWebSocket(
    {
      close: () => {
        throw close
      },
    },
    send,
  )
  expect(failure).toMatchObject({ cause: send, errors: [send, close] })
})
