/**
 * Mask credential-shaped substrings before a log line is persisted. Matching
 * is prefix-anchored (Slack xoxb-/xapp-, GitHub ghp_/github_pat_, Discord
 * Bot tokens, HTTP bearer values) so ordinary identifiers never trip it —
 * a false negative only weakens defense in depth, a false positive destroys
 * a legitimate log line.
 */
const SECRET_PATTERNS: ReadonlyArray<RegExp> = [
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
  /xapp-[A-Za-z0-9-]{10,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /Bot [A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{20,}/g,
  /Bearer [A-Za-z0-9._~+/-]{16,}/g,
]

export const redactSecrets = (text: string): string => {
  let redacted = text

  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[redacted]")
  }

  return redacted
}
