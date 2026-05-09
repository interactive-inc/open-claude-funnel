import { FunnelLogger } from "@/engine/logger/logger"

export class NoopFunnelLogger extends FunnelLogger {
  readonly file = null

  info(): void {}
  warn(): void {}
  error(): void {}
}
