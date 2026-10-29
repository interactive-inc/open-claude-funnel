import {
  createFlumeDefaultDeps,
  type FlumeLog,
  type FlumeLogHandler,
  type FlumeRuntimeDeps,
} from "@interactive-inc/flume"
import type { FunnelLogger } from "@/engine/logger/logger"

/**
 * `createFlumeDefaultDeps` is now Flume's contract for "the default runtime."
 * Re-exported only so callers can compose `{ ...flumeRuntimeDeps(), ...override }`
 * without importing two paths. In 0.4 `FlumeSourceOptions.deps` is optional
 * (Flume calls `createFlumeDefaultDeps` itself), so this is only needed when a
 * test wants to override one of the IO boundaries.
 */
export const flumeRuntimeDeps = createFlumeDefaultDeps

/**
 * Builds runtime deps without dropping prototype methods or eagerly resolving
 * the default WebSocket. Host callbacks keep their original receiver.
 */
export const resolveFlumeDeps = (
  override: Partial<FlumeRuntimeDeps> | undefined,
): FlumeRuntimeDeps | undefined => {
  if (!override) return undefined
  const keys = [
    "fetch",
    "WebSocket",
    "now",
    "random",
    "setTimeout",
    "clearTimeout",
    "setInterval",
    "clearInterval",
  ] as const satisfies readonly (keyof FlumeRuntimeDeps)[]
  const provided = keys.filter((key) => key in override)
  if (provided.length === 0) return undefined

  const deps = createFlumeDefaultDeps()
  for (const key of provided) {
    const value = override[key]
    if (key !== "WebSocket" && typeof value !== "function") {
      throw new TypeError(`Invalid runtime dependency: ${key}`)
    }
    Object.defineProperty(deps, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value:
        key === "WebSocket" ? value : Reflect.apply(Function.prototype.bind, value, [override]),
    })
  }
  return deps
}

/**
 * Bridges a `FunnelLogger` into Flume's structured log stream. Returns
 * `undefined` when no logger is wired so Flume's option stays cleanly absent
 * instead of carrying a no-op handler.
 *
 * Forwards everything Flume produces: `detail` (reconnect counters, HTTP codes,
 * parse offsets) is merged into the logger meta, and on errors the full stack
 * is preserved — the leaf message alone is rarely enough to pinpoint a socket
 * close or parse failure. Debug entries are dropped because FunnelLogger has no
 * debug level and routing them to info would drown the operator log in
 * heartbeats.
 */
export const flumeLogHandler = (logger: FunnelLogger | undefined): FlumeLogHandler | undefined => {
  if (!logger) return undefined

  return (log: FlumeLog) => {
    if (log.level === "debug") return

    const line = `${log.source}/${log.action}: ${log.message}`
    const meta = buildMeta(log)

    if (log.level === "error") {
      return logger.error(line, meta)
    }

    if (log.level === "warn") {
      return logger.warn(line, meta)
    }

    return logger.info(line, meta)
  }
}

const buildMeta = (log: FlumeLog): Record<string, unknown> | undefined => {
  const meta: Record<string, unknown> = { ...log.detail }

  if (log.error) {
    meta.error = log.error.message
    if (log.error.stack) meta.stack = log.error.stack
    if (log.error.name && log.error.name !== "Error") meta.errorName = log.error.name
  }

  return Object.keys(meta).length > 0 ? meta : undefined
}
