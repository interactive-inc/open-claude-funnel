const RAW_PREFIX = "funnel.token."
const ENCODED_PREFIX = "funnel.token-uri."
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/** Keep existing wire values when possible; URI escaping is valid inside an HTTP token. */
export function websocketTokenProtocol(token: string): string {
  if (TOKEN.test(token)) return `${RAW_PREFIX}${token}`
  const encoded = encodeURIComponent(token).replace(/[()]/g, (char) =>
    char === "(" ? "%28" : "%29",
  )
  return `${ENCODED_PREFIX}${encoded}`
}

/** Separate prefixes keep literal percent escapes in legacy credentials unambiguous. */
export function websocketProtocolToken(protocol: string): string | null {
  if (protocol.startsWith(RAW_PREFIX)) return protocol.slice(RAW_PREFIX.length)
  if (!protocol.startsWith(ENCODED_PREFIX)) return null
  try {
    return decodeURIComponent(protocol.slice(ENCODED_PREFIX.length))
  } catch {
    return null
  }
}
