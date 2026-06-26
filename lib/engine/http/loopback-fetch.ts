/**
 * Default ceiling on every loopback request to the gateway daemon. Five
 * seconds is well above the daemon's normal /status latency (microseconds)
 * but short enough that a wedged daemon does not hang the CLI / MCP / SDK
 * caller for any meaningful time.
 */
export const DEFAULT_LOOPBACK_TIMEOUT_MS = 5_000

/**
 * Wraps `fetch` with an automatic abort signal so a wedged gateway daemon
 * cannot hang the caller forever. Composes with a host-supplied
 * `init.signal`: if either the timeout or the host signal aborts, the
 * request is cancelled and `fetch` rejects with an AbortError.
 *
 * Returns the raw `Response` so callers can branch on `res.ok` / parse body
 * however they like — this is the lowest-level wrapper, not a JSON helper.
 */
export const loopbackFetch = async (
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_LOOPBACK_TIMEOUT_MS,
): Promise<Response> => {
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal

  return fetch(url, { ...init, signal })
}
