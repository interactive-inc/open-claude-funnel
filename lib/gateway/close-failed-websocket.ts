import type { ServerWebSocket } from "bun"

/** Force the subscriber onto its replay path while preserving failed cleanup for the host. */
export function closeFailedWebSocket(
  socket: Pick<ServerWebSocket<unknown>, "close">,
  failure: Error,
): Error {
  try {
    socket.close(1011, "event delivery failed; reconnect from the accepted offset")
    return failure
  } catch (cleanup) {
    return new AggregateError([failure, cleanup], "WebSocket delivery and close failed", {
      cause: failure,
    })
  }
}
