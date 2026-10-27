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
  abstract start(notify: NotifyFn, signal?: AbortSignal): Promise<void>
  abstract stop(): Promise<void>
  /** Actual transport availability; reconnecting listeners may still be alive. */
  isConnected(): boolean {
    return this.isAlive()
  }

  isAlive(): boolean {
    return true
  }
}
