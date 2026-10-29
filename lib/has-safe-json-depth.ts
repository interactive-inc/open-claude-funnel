/** Avoid parser/serializer stack exhaustion before parsing untrusted JSON. */
export function hasSafeJsonDepth(payload: string): boolean {
  let depth = 0
  let quoted = false
  let escaped = false
  for (const character of payload) {
    if (quoted) {
      if (escaped) escaped = false
      else if (character === "\\") escaped = true
      else if (character === '"') quoted = false
      continue
    }
    if (character === '"') quoted = true
    else if (character === "{" || character === "[") {
      depth++
      if (depth > 128) return false
    } else if (character === "}" || character === "]") depth--
  }
  return true
}
