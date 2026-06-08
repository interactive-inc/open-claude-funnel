import { describe, expect, test } from "vitest"
import { queryToCliArgs } from "@/cli/router/query-to-cli-args"

describe("queryToCliArgs", () => {
  test("help is always excluded", () => {
    expect(queryToCliArgs("http://x/?help=true&foo=bar")).toEqual(["--foo", "bar"])
  })

  test("reservedKeys can be excluded", () => {
    const args = queryToCliArgs("http://x/?channel=a&version=true", ["channel"])
    expect(args).toEqual(["--version"])
  })

  test("value=true emits the flag only", () => {
    expect(queryToCliArgs("http://x/?force=true")).toEqual(["--force"])
  })

  test("regular values emit --key value pairs", () => {
    expect(queryToCliArgs("http://x/?name=alice")).toEqual(["--name", "alice"])
  })
})
