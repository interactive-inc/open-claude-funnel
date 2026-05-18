import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { funnelJsonSchema } from "@/engine/local-config/local-config-json-schema"

export const schemaHelp = `funnel schema — print the JSON Schema for funnel.json

usage: funnel schema

Outputs the draft 2020-12 JSON Schema describing the per-repo funnel.json
file. Pipe it into a local file and reference it from funnel.json so editors
can validate and autocomplete the config:

  fnl schema > funnel.schema.json

  # funnel.json
  {
    "$schema": "./funnel.schema.json",
    "channel": "ops"
  }`

export const schemaHandler = factory.createHandlers(
  zValidator("query", z.object({}), schemaHelp),
  async (c) => {
    const schema = funnelJsonSchema()

    return c.text(`${JSON.stringify(schema, null, 2)}\n`)
  },
)
