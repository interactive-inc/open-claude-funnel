import type { FunnelLogger } from "@/engine/logger/logger"
import type { OnFunnelError } from "@/engine/error/on-funnel-error"
import { invokeCallback } from "@/gateway/invoke-callback"

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
      onError?.(error instanceof Error ? error : new Error(String(error)), {
        component: "gateway-logger",
      }),
  )
}
