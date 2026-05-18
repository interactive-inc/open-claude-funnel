import { z } from "zod"
import { localConfigSchema } from "@/engine/local-config/local-config-schema"

/**
 * Generates the JSON Schema (draft 2020-12) for `funnel.json`. Useful for
 * `$schema` references in committed `funnel.json` files so editors can give
 * autocomplete and validation for channel / subAgent / env / connectors[]
 * without anyone hand-maintaining a separate schema.
 */
export const funnelJsonSchema = (): Record<string, unknown> => {
  const schema = z.toJSONSchema(localConfigSchema, { target: "draft-2020-12" })

  return {
    ...schema,
    title: "Funnel per-repo launch config",
    description:
      "Used by `fnl claude` when no --profile / --channel is given. Declares the channel to subscribe to, optional sub-agent and brief flag, environment variables to layer under process.env, and optional connectors to materialize into ~/.funnel/settings.json on launch.",
  }
}
