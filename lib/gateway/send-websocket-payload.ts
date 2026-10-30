import type { ServerWebSocket } from "bun"

/** Bun accepts -1 as queued backpressure; zero drops every non-empty event payload. */
export function sendWebSocketPayload(
  socket: Pick<ServerWebSocket<unknown>, "send">,
  payload: string,
): void {
  if (socket.send(payload) === 0 && payload.length > 0)
    throw new Error("WebSocket dropped a non-empty event payload")
}
