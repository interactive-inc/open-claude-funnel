/**
 * Structured logger with three levels and an optional log-file path.
 * Defaults to NodeFunnelLogger (appends to `<os.tmpdir()>/funnel/funnel.log`);
 * MemoryFunnelLogger captures entries in memory and NoopFunnelLogger silences output.
 */
export abstract class FunnelLogger {
  abstract info(message: string, meta?: Record<string, unknown>): void
  abstract warn(message: string, meta?: Record<string, unknown>): void
  abstract error(message: string, meta?: Record<string, unknown>): void
  abstract readonly file: string | null
}
