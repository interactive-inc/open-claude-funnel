export abstract class FunnelLogger {
  abstract info(message: string, meta?: Record<string, unknown>): void
  abstract warn(message: string, meta?: Record<string, unknown>): void
  abstract error(message: string, meta?: Record<string, unknown>): void
  abstract readonly file: string | null
}
