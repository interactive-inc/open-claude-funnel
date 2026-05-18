import { describe, expect, test } from "vitest"
import { funnelJsonSchema } from "@/engine/local-config/local-config-json-schema"

describe("funnelJsonSchema", () => {
  test("emits a draft-2020-12 object schema", () => {
    const schema = funnelJsonSchema()

    expect(schema.$schema).toEqual("https://json-schema.org/draft/2020-12/schema")
    expect(schema.type).toEqual("object")
  })

  test("declares the funnel.json fields", () => {
    const schema = funnelJsonSchema() as { properties: Record<string, unknown>; required: string[] }

    expect(schema.properties).toHaveProperty("channel")
    expect(schema.properties).toHaveProperty("options")
    expect(schema.properties).toHaveProperty("env")
    expect(schema.properties).toHaveProperty("connectors")
    expect(schema.required).toContain("channel")
  })

  test("includes a discriminated connector union", () => {
    const schema = funnelJsonSchema() as {
      properties: { connectors: { items: { anyOf?: unknown[]; oneOf?: unknown[] } } }
    }

    const items = schema.properties.connectors.items
    const variants = items.anyOf ?? items.oneOf

    expect(Array.isArray(variants) && variants.length).toBeGreaterThanOrEqual(4)
  })
})
