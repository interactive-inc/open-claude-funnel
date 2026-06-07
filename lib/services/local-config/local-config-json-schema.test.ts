import { describe, expect, test } from "bun:test"
import { funnelJsonSchema } from "@/services/local-config/local-config-json-schema"

describe("funnelJsonSchema", () => {
  test("emits a draft-2020-12 object schema", () => {
    const schema = funnelJsonSchema()

    expect(schema.$schema).toEqual("https://json-schema.org/draft/2020-12/schema")
    expect(schema.type).toEqual("object")
  })

  test("declares the funnel.json fields", () => {
    const schema = funnelJsonSchema() as { properties: Record<string, unknown>; required: string[] }

    expect(schema.properties).toHaveProperty("channels")
    expect(schema.required).toContain("channels")
  })

  test("each channel declares name / connectors (transport only)", () => {
    const schema = funnelJsonSchema() as {
      properties: {
        channels: { items: { properties: Record<string, unknown> } }
      }
    }

    const channelProps = schema.properties.channels.items.properties

    expect(channelProps).toHaveProperty("name")
    expect(channelProps).toHaveProperty("connectors")
    expect(channelProps).not.toHaveProperty("options")
    expect(channelProps).not.toHaveProperty("env")
  })

  test("each profile declares name / channel / options / env / resume (launch recipe)", () => {
    const schema = funnelJsonSchema() as {
      properties: {
        profiles: { items: { properties: Record<string, unknown> } }
      }
    }

    const profileProps = schema.properties.profiles.items.properties

    expect(profileProps).toHaveProperty("name")
    expect(profileProps).toHaveProperty("channel")
    expect(profileProps).toHaveProperty("options")
    expect(profileProps).toHaveProperty("env")
    expect(profileProps).toHaveProperty("resume")
  })

  test("each channel item declares a discriminated connector union", () => {
    const schema = funnelJsonSchema() as {
      properties: {
        channels: {
          items: {
            properties: { connectors: { items: { anyOf?: unknown[]; oneOf?: unknown[] } } }
          }
        }
      }
    }

    const items = schema.properties.channels.items.properties.connectors.items
    const variants = items.anyOf ?? items.oneOf

    expect(Array.isArray(variants) && variants.length).toBeGreaterThanOrEqual(4)
  })
})
