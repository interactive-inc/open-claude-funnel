/** Preserve both host shutdown and per-listener startup/ownership cancellation. */
export function listenerSignal(host?: AbortSignal, startup?: AbortSignal): AbortSignal | undefined {
  if (!host) return startup
  if (!startup) return host

  return AbortSignal.any([host, startup])
}
