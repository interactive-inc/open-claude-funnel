/**
 * The HTTP base URL of a gateway daemon on the loopback interface. The daemon
 * always binds 127.0.0.1 for its management API (only the WS `/ws` endpoint is
 * ever exposed off-box), so every in-process HTTP client — publisher, listeners
 * client, MCP channel server — talks to it here. Centralizing the construction
 * keeps the host/port shape in one place instead of re-spelling
 * `http://127.0.0.1:${port}` at each call site.
 */
export function gatewayLoopbackUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}
