const BUILTIN_SKIP = new Set(["help"])

export const queryToCliArgs = (url: string, reservedKeys: string[] = []): string[] => {
  const skipped = new Set([...BUILTIN_SKIP, ...reservedKeys])
  const args: string[] = []
  const searchParams = new URL(url).searchParams

  for (const entry of searchParams.entries()) {
    const key = entry[0]
    const value = entry[1]

    if (skipped.has(key)) continue

    args.push(`--${key}`)

    if (value !== "true") args.push(value)
  }

  return args
}
