import { FunnelLogger } from "@/modules/logger/funnel-logger"

export class NoopFunnelLogger extends FunnelLogger {
  readonly file = null

  info(): void {}
  warn(): void {}
  error(): void {}
}
