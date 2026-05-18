/**
 * Asks the user for a secret value on stdin. Used as a last resort when a
 * funnel.json token field is absent and not present in `~/.funnel`. The Node
 * implementation refuses to prompt when stdin is not a TTY so non-interactive
 * launches (CI, agent spawning agent, daemons) fail fast instead of hanging.
 */
export abstract class FunnelTokenPrompter {
  abstract promptSecret(label: string): Promise<string>
}
