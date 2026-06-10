import { stringify } from "yaml"

/**
 * Render any value as a valid YAML document for CLI output.
 *
 * The CLI never emits JSON: text and YAML are the two surfaces, and YAML
 * subsumes both since plain strings round-trip as themselves. This keeps
 * Claude's job simple — every command's output is parseable the same way.
 *
 * Numbers, booleans, null, and primitive arrays stringify trivially. For
 * objects we use blocks (indent + dash) rather than flow (`{...}`), since
 * indentation is what Claude actually reads.
 */
export const renderYaml = (value: unknown): string => {
  if (typeof value === "string") return value

  return stringify(value, { indent: 2, lineWidth: 0, defaultStringType: "PLAIN" })
}
