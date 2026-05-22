type RecipeQuery = {
  agent?: string
  options?: string
  env?: string
  resume?: string
  "no-resume"?: string
}

export type ParsedProfileRecipe = {
  options?: string[]
  env?: Record<string, string>
  resume?: boolean
}

/**
 * Turns the single-string CLI flags (`--agent`, `--options "<argv>"`,
 * `--env "k=v,k=v"`, `--resume` / `--no-resume`) into the profile recipe.
 * A field stays `undefined` when its flag is absent so `profiles.update`
 * leaves it untouched. `--options` is whitespace-split, so values that
 * themselves contain spaces are not expressible here — set those via
 * funnel.json instead.
 */
export const parseProfileRecipe = (query: RecipeQuery): ParsedProfileRecipe => {
  const recipe: ParsedProfileRecipe = {}

  if (query.agent !== undefined || query.options !== undefined) {
    const options: string[] = []

    if (query.agent !== undefined) {
      options.push("--agent", query.agent)
    }

    if (query.options !== undefined) {
      for (const token of query.options.split(/\s+/)) {
        if (token.length > 0) options.push(token)
      }
    }

    recipe.options = options
  }

  if (query.env !== undefined) {
    const env: Record<string, string> = {}

    for (const pair of query.env.split(",")) {
      const trimmed = pair.trim()

      if (trimmed.length === 0) continue

      const eq = trimmed.indexOf("=")

      if (eq < 0) continue

      env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1)
    }

    recipe.env = env
  }

  if (query["no-resume"] !== undefined) {
    recipe.resume = false
  } else if (query.resume !== undefined) {
    recipe.resume = query.resume !== "false"
  }

  return recipe
}
