/**
 * Resolves a connector token from either a literal value or the name of an env
 * var. A connector config carries one or the other per slot (see
 * slack-connector-schema): literals are inlined into settings.json, references
 * keep the secret in the environment (`.env.local`) and out of settings.json.
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
  if (props.literal !== undefined && props.literal !== "") return props.literal

  if (props.envVar !== undefined && props.envVar !== "") {
    const fromEnv = props.env[props.envVar]

    if (fromEnv !== undefined && fromEnv !== "") return fromEnv

    throw new Error(
      `${props.label} references env var "${props.envVar}" but it is not set in the environment`,
    )
  }

  throw new Error(`${props.label} has neither a literal token nor an env var reference`)
}
