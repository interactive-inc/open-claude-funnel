import { describe, expect, test } from "vitest"
import { toRequest } from "@/cli/router/to-request"

describe("toRequest", () => {
  test("add is POST and keeps the keyword in path", () => {
    expect(toRequest(["connectors", "add", "x"])).toMatchObject({
      method: "POST",
      path: "/connectors/add/x",
    })
  })

  test("remove is POST and keeps the keyword in path", () => {
    expect(toRequest(["connectors", "remove", "x"])).toMatchObject({
      method: "POST",
      path: "/connectors/remove/x",
    })
  })

  test("rename is POST and keeps args in path", () => {
    expect(toRequest(["connectors", "rename", "a", "b"])).toMatchObject({
      method: "POST",
      path: "/connectors/rename/a/b",
    })
  })

  test("set is POST and keeps the keyword in path", () => {
    const req = toRequest(["connectors", "x", "set", "--bot-token", "xoxb-z"])
    expect(req.method).toBe("POST")
    expect(req.path).toBe("/connectors/x/set")
    expect(new URL(req.url).searchParams.get("bot-token")).toBe("xoxb-z")
  })

  test("nested connector add is POST and keeps the keyword in path", () => {
    expect(toRequest(["channels", "x", "connectors", "add", "s"])).toMatchObject({
      method: "POST",
      path: "/channels/x/connectors/add/s",
    })
  })

  test("nested connector remove is POST and keeps the keyword in path", () => {
    expect(toRequest(["channels", "x", "connectors", "remove", "s"])).toMatchObject({
      method: "POST",
      path: "/channels/x/connectors/remove/s",
    })
  })

  test("request is POST and keeps the keyword in path", () => {
    expect(toRequest(["channels", "x", "connectors", "s", "request"])).toMatchObject({
      method: "POST",
      path: "/channels/x/connectors/s/request",
    })
  })

  test("as-default is POST and keeps the keyword in path", () => {
    expect(toRequest(["profiles", "cto", "as-default"])).toMatchObject({
      method: "POST",
      path: "/profiles/cto/as-default",
    })
  })

  test("API method becomes a path segment, path/body move to query", () => {
    const req = toRequest(["request", "slack", "post", "chat.postMessage", '{"a":1}'])
    expect(req.path).toBe("/request/slack/post")
    const params = new URL(req.url).searchParams
    expect(params.get("path")).toBe("chat.postMessage")
    expect(params.get("body")).toBe('{"a":1}')
  })

  test("--flag and --flag value are added to query", () => {
    const req = toRequest(["profiles", "add", "x", "--path", "/tmp/x", "--help"])
    const params = new URL(req.url).searchParams
    expect(params.get("path")).toBe("/tmp/x")
    expect(params.get("help")).toBe("true")
  })

  test("-h maps to --help", () => {
    const req = toRequest(["profiles", "-h"])
    expect(new URL(req.url).searchParams.get("help")).toBe("true")
  })

  test("-p maps to --profile", () => {
    const req = toRequest(["claude", "-p", "cto"])
    expect(new URL(req.url).searchParams.get("profile")).toBe("cto")
  })
})
