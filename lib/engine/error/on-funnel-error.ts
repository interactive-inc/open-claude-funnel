/**
 * Host integration hook called when Funnel catches an exception that would
 * otherwise be silently swallowed (subscriber throw, listener start failure,
 * MCP forward failure, etc.). Pass `Sentry.captureException` from the host to
 * pipe these into your error reporter. Defaults to a no-op when omitted.
 *
 * `context` carries the component name and any extra metadata the caller had
 * at the catch site (channel / connector / subscriber id when available).
 */
export type OnFunnelError = (error: Error, context?: Record<string, unknown>) => void
