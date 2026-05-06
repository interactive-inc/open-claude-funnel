/**
 * Parse a comma-separated text input into a clean string array.
 *
 * Used by the editable channels (connector list) and profiles (env-files)
 * views to turn the user's free-form input ("a, b , c,") into the
 * actual list ["a", "b", "c"]. Empty entries and surrounding whitespace
 * are dropped so trailing commas and stray spaces don't matter.
 */
export function parseCommaList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}
