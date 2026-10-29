/** JSON escaping avoids Bun's lossy direct binding of unpaired UTF-16 surrogates. */
export const SQLITE_TEXT_PARAMETER = "json_extract(?, '$')"

/** Decode inside SQLite so indexed TEXT retains the same code units as the JSON payload. */
export function encodeSqliteText(value: string | null): string {
  return JSON.stringify(value)
}
