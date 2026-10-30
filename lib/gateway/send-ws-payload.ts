import type { ServerWebSocket } from "bun"
import { sendWebSocketPayload } from "@/gateway/send-websocket-payload"
import { WebSocketBackpressureError } from "@/gateway/errors"

/** Bun reports dropped sends as zero; -1 means the payload was accepted under backpressure. */
export function sendWsPayload(
  socket: ServerWebSocket<unknown>,
  payload: string,
  maxBufferedBytes: number,
  canSend?: () => boolean,
): void {
  if (canSend && !canSend()) return
  const buffered = socket.getBufferedAmount()
  if (canSend && !canSend()) return
  if (buffered > maxBufferedBytes) throw new WebSocketBackpressureError(buffered)
  const send = socket.send
  if (canSend && !canSend()) return
  sendWebSocketPayload({ send: (value) => send.call(socket, value) }, payload)
}
