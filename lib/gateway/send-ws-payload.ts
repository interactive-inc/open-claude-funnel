import type { ServerWebSocket } from "bun"
import { WebSocketBackpressureError } from "@/gateway/errors"

/** Bun reports dropped sends as zero; -1 means the payload was accepted under backpressure. */
export function sendWsPayload(
  socket: ServerWebSocket<unknown>,
  payload: string,
  maxBufferedBytes: number,
): void {
  const buffered = socket.getBufferedAmount()
  if (buffered > maxBufferedBytes) throw new WebSocketBackpressureError(buffered)
  if (socket.send(payload) === 0) throw new Error("WebSocket send dropped the message")
}
