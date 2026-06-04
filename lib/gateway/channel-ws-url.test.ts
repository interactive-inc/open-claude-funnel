import { describe, expect, test } from "bun:test"
import { channelWsProtocols, channelWsUrl } from "@/gateway/channel-ws-url"

describe("channelWsUrl", () => {
  test("includes channel as a query param", () => {
    const url = channelWsUrl({ base: "ws://localhost:9743/ws", channel: "inta" })

    expect(url).toBe("ws://localhost:9743/ws?channel=inta")
  })

  test("adds subscriberId as id", () => {
    const url = channelWsUrl({
      base: "ws://localhost:9743/ws",
      channel: "inta",
      subscriberId: "abc-123",
    })

    expect(new URL(url).searchParams.get("id")).toBe("abc-123")
  })

  test("omits id when subscriberId is absent", () => {
    const url = channelWsUrl({ base: "ws://localhost:9743/ws", channel: "inta" })

    expect(new URL(url).searchParams.has("id")).toBe(false)
  })

  test("adds since when provided", () => {
    const url = channelWsUrl({ base: "ws://localhost:9743/ws", channel: "inta", since: 42 })

    expect(new URL(url).searchParams.get("since")).toBe("42")
  })

  test("includes since=0 (falsy but valid offset)", () => {
    const url = channelWsUrl({ base: "ws://localhost:9743/ws", channel: "inta", since: 0 })

    expect(new URL(url).searchParams.get("since")).toBe("0")
  })

  test("preserves an existing query on the base", () => {
    const url = channelWsUrl({ base: "ws://host/ws?foo=bar", channel: "inta" })
    const parsed = new URL(url)

    expect(parsed.searchParams.get("foo")).toBe("bar")
    expect(parsed.searchParams.get("channel")).toBe("inta")
  })

  test("encodes special characters in channel and id", () => {
    const url = channelWsUrl({
      base: "ws://host/ws",
      channel: "a b&c",
      subscriberId: "x/y",
    })
    const parsed = new URL(url)

    expect(parsed.searchParams.get("channel")).toBe("a b&c")
    expect(parsed.searchParams.get("id")).toBe("x/y")
  })
})

describe("channelWsProtocols", () => {
  test("wraps a token as funnel.token.<token>", () => {
    expect(channelWsProtocols("secret")).toEqual(["funnel.token.secret"])
  })

  test("returns empty array for null / undefined / empty", () => {
    expect(channelWsProtocols(null)).toEqual([])
    expect(channelWsProtocols(undefined)).toEqual([])
    expect(channelWsProtocols("")).toEqual([])
  })
})
