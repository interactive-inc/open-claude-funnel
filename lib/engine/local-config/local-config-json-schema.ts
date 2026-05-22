import { z } from "zod"
import { localConfigSchema } from "@/engine/local-config/local-config-schema"

/**
 * Generates the JSON Schema (draft 2020-12) for `funnel.json`. Useful for
 * `$schema` references in committed `funnel.json` files so editors can give
 * autocomplete and validation for channels[] (transport) and profiles[]
 * (launch recipe) without anyone hand-maintaining a separate schema.
 */
export const funnelJsonSchema = (): Record<string, unknown> => {
  const schema = z.toJSONSchema(localConfigSchema, { target: "draft-2020-12" })

  return {
    ...schema,
    title: "Funnel per-repo launch config",
    description:
      "Used by `fnl claude` to declare channels (transport: connectors to materialize into ~/.funnel/settings.json on launch) and profiles (launch recipe: options / env / resume) bound to those channels.",
  }
}
