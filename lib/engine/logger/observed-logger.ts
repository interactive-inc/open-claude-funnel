import { FunnelLogger } from "@/engine/logger/logger"
import { invokeCallback } from "@/invoke-callback"

/** Keep host logging failures outside the caller's lifecycle and observe async results. */
export class ObservedFunnelLogger extends FunnelLogger {
  constructor(
    private readonly logger: FunnelLogger,
    private readonly onError: (error: unknown) => unknown,
  ) {
    super()
  }

  get file(): string | null {
    return this.logger.file
  }

  info(message: string, meta?: Record<string, unknown>): void {
    invokeCallback(() => this.logger.info(message, meta), this.onError)
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    invokeCallback(() => this.logger.warn(message, meta), this.onError)
  }

  error(message: string, meta?: Record<string, unknown>): void {
    invokeCallback(() => this.logger.error(message, meta), this.onError)
  }
}
