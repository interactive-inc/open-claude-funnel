import type { ServerWebSocket } from "bun"
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
  if (send.call(socket, payload) === 0) throw new Error("WebSocket send dropped the message")
}
