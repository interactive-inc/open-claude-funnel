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
 * Builds the merged runtime deps Flume listeners pass to a source. Spreads the
 * default IO over any partial test override and returns `undefined` when no
 * override exists so Flume gets to use its own internal default and there is
 * one less degree of freedom to debug.
 */
export const resolveFlumeDeps = (
  override: Partial<FlumeRuntimeDeps> | undefined,
): FlumeRuntimeDeps | undefined => {
  if (!override || Object.keys(override).length === 0) return undefined

  return { ...createFlumeDefaultDeps(), ...override }
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
      logger.error(line, meta)
      return
    }

    if (log.level === "warn") {
      logger.warn(line, meta)
      return
    }

    logger.info(line, meta)
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
