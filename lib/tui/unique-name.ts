/**
 * Pick the first `${prefix}-N` (N = 1, 2, …) that doesn't appear in the
 * `existing` list.
 *
 * Used by the connectors / channels / profiles views to mint a unique
 * default name when the user clicks "+ add". Stops at 10 000 to avoid a
 * runaway loop if `existing` is full of placeholder names — falls back
 * to `${prefix}-${Date.now()}` so the caller still gets a legal name.
 */
export function uniqueName(existing: string[], prefix: string): string {
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${prefix}-${i}`

    if (!existing.includes(candidate)) return candidate
  }

  return `${prefix}-${Date.now()}`
}
