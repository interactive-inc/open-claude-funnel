export type NotifyFn = (content: string, meta?: Record<string, string>) => Promise<void>

export abstract class FunnelConnectorListener {
  abstract start(notify: NotifyFn): Promise<void>
}
