import {
  createFlumeDefaultDeps,
  type FlumeLog,
  type FlumeLogHandler,
} from "@interactive-inc/flume"
import type { FunnelLogger } from "@/engine/logger/logger"

/**
 * Returns Flume's stock runtime deps (`fetch` / `WebSocket` / timers / clock /
 * random) so every listener uses the same wiring. Tests override individual
 * fields by spreading their own partial on top.
 */
export const flumeRuntimeDeps = createFlumeDefaultDeps

/**
 * Bridges a `FunnelLogger` into Flume's structured log stream. Returns
 * `undefined` when no logger is wired so Flume's option stays cleanly absent
 * instead of carrying a no-op handler.
 */
export const flumeLogHandler = (
  logger: FunnelLogger | undefined,
): FlumeLogHandler | undefined => {
  if (!logger) return undefined

  return (log: FlumeLog) => {
    const line = `${log.source}/${log.action}: ${log.message}`

    if (log.level === "error") {
      logger.error(line, log.error ? { error: log.error.message } : {})
      return
    }

    if (log.level === "warn") {
      logger.warn(line)
      return
    }

    logger.info(line)
  }
}
