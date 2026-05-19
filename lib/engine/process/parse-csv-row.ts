/**
 * Parse a single CSV row produced by Windows tools such as
 * `ConvertTo-Csv -NoTypeInformation`. Returns the trimmed cell array.
 * Supports embedded quotes via the `""` escape and quoted commas.
 */
export function parseCsvRow(line: string): string[] {
  const cells: string[] = []
  const chars = Array.from(line)
  let current = ""
  let inQuotes = false
  let cursor = 0

  while (cursor < chars.length) {
    const char = chars[cursor] ?? ""

    if (inQuotes) {
      if (char === '"' && chars[cursor + 1] === '"') {
        current += '"'
        cursor += 2
        continue
      }

      if (char === '"') {
        inQuotes = false
        cursor += 1
        continue
      }

      current += char
      cursor += 1
      continue
    }

    if (char === '"') {
      inQuotes = true
      cursor += 1
      continue
    }

    if (char === ",") {
      cells.push(current)
      current = ""
      cursor += 1
      continue
    }

    current += char
    cursor += 1
  }

  cells.push(current)

  return cells
}
