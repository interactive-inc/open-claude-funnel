import type { FunnelLogger } from "@/engine/logger/logger"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { invokeCallback } from "@/invoke-callback"
import { normalizeError } from "@/engine/error/error-message-of"

/** Informational logging must not alter connection lifecycle or delivery. */
export function logInfo(
  logger: FunnelLogger | undefined,
  onError: OnFunnelError | undefined,
  message: string,
  meta?: Record<string, unknown>,
): void {
  invokeCallback(
    () => logger?.info(message, meta),
    (error) =>
      onError?.(normalizeError(error), {
        component: "gateway-logger",
      }),
  )
}
