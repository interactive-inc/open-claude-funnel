/** The socket has exceeded the gateway's bounded outbound buffer. */
export class WebSocketBackpressureError extends Error {
  constructor(readonly buffered: number) {
    super("WebSocket backpressure limit exceeded")
    this.name = "WebSocketBackpressureError"
  }
}
