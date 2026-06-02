import { describe, expect, test } from "bun:test"
import { previewOf, toDebugConnectionError, toDebugEvent } from "@/cli/routes/debug-row"

describe("toDebugEvent", () => {
  test("narrows a well-formed processed row", () => {
    const event = toDebugEvent({
      seq: 7,
      ts: 1700000000000,
      type: "message",
      outcome: "emitted",
      event_id: "evt-1",
      payload: '{"text":"hello"}',
    })

    expect(event.seq).toBe(7)
    expect(event.ts).toBe(1700000000000)
    expect(event.type).toBe("message")
    expect(event.outcome).toBe("emitted")
    expect(event.eventId).toBe("evt-1")
    expect(event.payload).toBe('{"text":"hello"}')
    expect(event.payloadParsed).toEqual({ text: "hello" })
    expect(event.preview).toBe("hello")
  })

  test("falls back to defaults when fields are wrong-typed or missing", () => {
    const event = toDebugEvent({ seq: "nope", ts: null, type: 42 })

    expect(event.seq).toBeNull()
    expect(event.ts).toBeNull()
    expect(event.type).toBe("?")
    expect(event.outcome).toBe("?")
    expect(event.eventId).toBeNull()
    expect(event.payload).toBeNull()
    expect(event.payloadParsed).toBeNull()
    expect(event.preview).toBeNull()
  })

  test("treats a non-object JSON payload as unparsed", () => {
    const event = toDebugEvent({ payload: "[1,2,3]" })

    expect(event.payload).toBe("[1,2,3]")
    expect(event.payloadParsed).toBeNull()
  })

  test("keeps the raw payload but no parse for malformed JSON", () => {
    const event = toDebugEvent({ payload: "{not json" })

    expect(event.payload).toBe("{not json")
    expect(event.payloadParsed).toBeNull()
    expect(event.preview).toBe("{not json")
  })
})

describe("toDebugConnectionError", () => {
  test("narrows a well-formed connection row", () => {
    const error = toDebugConnectionError({
      seq: 3,
      ts: 1700000000000,
      type: "slack",
      status: "auth-failed",
      detail: "invalid token",
    })

    expect(error.seq).toBe(3)
    expect(error.status).toBe("auth-failed")
    expect(error.detail).toBe("invalid token")
  })

  test("nulls an empty detail string", () => {
    const error = toDebugConnectionError({ status: "error", detail: "" })

    expect(error.status).toBe("error")
    expect(error.detail).toBeNull()
  })
})

describe("previewOf", () => {
  test("prefers the text field of a JSON object", () => {
    expect(previewOf('{"text":"a reply"}')).toBe("a reply")
  })

  test("falls back to the raw string for non-object payloads", () => {
    expect(previewOf("plain text")).toBe("plain text")
  })

  test("truncates long previews to 60 chars plus ellipsis", () => {
    const long = "x".repeat(100)
    const preview = previewOf(long)

    expect(preview).not.toBeNull()
    expect(preview?.endsWith("…")).toBe(true)
    expect(preview?.length).toBe(61)
  })

  test("returns null for non-strings and empty strings", () => {
    expect(previewOf(null)).toBeNull()
    expect(previewOf("")).toBeNull()
    expect(previewOf(123)).toBeNull()
  })
})
