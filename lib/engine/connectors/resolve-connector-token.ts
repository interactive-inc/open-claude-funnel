/**
 * Resolves a connector token from either a literal value or the name of an env
 * var. A non-empty literal takes precedence over a reference. Literals are part
 * of the host's configuration; references keep the secret in the explicitly
 * supplied environment dictionary.
 *
 * Errors loudly when neither yields a value — a misconfigured connector should
 * fail at listener start, not connect with an empty token and silently never
 * receive events.
 */
export const resolveConnectorToken = (props: {
  literal: string | undefined
  envVar: string | undefined
  env: NodeJS.ProcessEnv
  label: string
}): string => {
  const literal = props.literal
  if (literal !== undefined && typeof literal !== "string")
    throw new TypeError(`${props.label} literal token must be a string`)
  if (literal !== undefined && literal !== "") return literal

  const envVar = props.envVar
  if (envVar !== undefined && typeof envVar !== "string")
    throw new TypeError(`${props.label} env var reference must be a string`)
  if (envVar !== undefined && envVar !== "") {
    const env = props.env
    const fromEnv = Object.hasOwn(env, envVar) ? env[envVar] : undefined

    if (typeof fromEnv === "string" && fromEnv !== "") return fromEnv

    throw new Error(
      `${props.label} references env var "${envVar}" but it is not set in the environment`,
    )
  }

  throw new Error(`${props.label} has neither a literal token nor an env var reference`)
}
