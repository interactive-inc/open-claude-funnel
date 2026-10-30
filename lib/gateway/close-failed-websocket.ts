import type { ServerWebSocket } from "bun"

/** Force the subscriber onto its replay path while preserving failed cleanup for the host. */
export function closeFailedWebSocket(
  socket: Pick<ServerWebSocket<unknown>, "close">,
  failure: Error,
  reason = "event delivery failed; reconnect from the accepted offset",
): Error {
  try {
    socket.close(1011, reason)
    return failure
  } catch (cleanup) {
    return new AggregateError([failure, cleanup], "WebSocket delivery and close failed", {
      cause: failure,
    })
  }
}
