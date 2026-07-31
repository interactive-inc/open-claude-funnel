export type NotifyFn = (content: string, meta?: Record<string, string>) => Promise<void>

/**
 * Long-lived event source for one connector.
 *
 * `start()` opens the underlying connection (Slack Socket Mode, Discord
 * Gateway, GH polling, schedule tick) and pushes events through `notify`.
 * `stop()` releases the resources so the listener registry can recreate the listener
 * with new config without restarting the whole gateway. `isAlive()` lets the
 * listener registry periodically health-checks and auto-restarts dead listeners; the
 * default optimistic implementation is fine for poll/tick-based listeners
 * that self-heal.
 */
export abstract class FunnelConnectorListener {
  abstract start(notify: NotifyFn): Promise<void>
  abstract stop(): Promise<void>
  isAlive(): boolean {
    return true
  }
}
