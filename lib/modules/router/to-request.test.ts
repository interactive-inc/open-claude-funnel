import { describe, expect, test } from "bun:test"
import { toRequest } from "@/modules/router/to-request"

describe("toRequest", () => {
  test("add is POST", () => {
    expect(toRequest(["connectors", "add", "x"])).toMatchObject({
      method: "POST",
      path: "/connectors/x",
    })
  })

  test("remove is DELETE", () => {
    expect(toRequest(["connectors", "remove", "x"])).toMatchObject({
      method: "DELETE",
      path: "/connectors/x",
    })
  })

  test("rename is PUT and keeps args in path", () => {
    expect(toRequest(["connectors", "rename", "a", "b"])).toMatchObject({
      method: "PUT",
      path: "/connectors/rename/a/b",
    })
  })

  test("set is PUT and drops the keyword from path", () => {
    const req = toRequest(["connectors", "x", "set", "--bot-token", "xoxb-z"])
    expect(req.method).toBe("PUT")
    expect(req.path).toBe("/connectors/x")
    expect(new URL(req.url).searchParams.get("bot-token")).toBe("xoxb-z")
  })

  test("attach is PUT and keeps args in path", () => {
    expect(toRequest(["channels", "x", "connectors", "attach", "s"])).toMatchObject({
      method: "PUT",
      path: "/channels/x/connectors/attach/s",
    })
  })

  test("API call (post) moves method/path/body into query params", () => {
    const req = toRequest(["connectors", "x", "post", "chat.postMessage", '{"a":1}'])
    expect(req.path).toBe("/connectors/x/call")
    const params = new URL(req.url).searchParams
    expect(params.get("method")).toBe("post")
    expect(params.get("path")).toBe("chat.postMessage")
    expect(params.get("body")).toBe('{"a":1}')
  })

  test("--flag and --flag value are added to query", () => {
    const req = toRequest(["repos", "add", "x", "--path", "/tmp/x", "--help"])
    const params = new URL(req.url).searchParams
    expect(params.get("path")).toBe("/tmp/x")
    expect(params.get("help")).toBe("true")
  })

  test("-h maps to --help", () => {
    const req = toRequest(["repos", "-h"])
    expect(new URL(req.url).searchParams.get("help")).toBe("true")
  })
})
