import { describe, expect, test } from "bun:test"
import { FunnelDotenvReader } from "@/engine/local-config/dotenv-reader"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"

describe("FunnelDotenvReader", () => {
  test("returns empty object when .env.local is missing", () => {
    const fs = new MemoryFunnelFileSystem()
    const reader = new FunnelDotenvReader({ fs })

    expect(reader.read("/repo")).toEqual({})
  })

  test("parses KEY=value lines and ignores blanks and comments", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/.env.local": [
          "# header",
          "",
          "SLACK_BOT_TOKEN=xoxb-abc",
          " SLACK_APP_TOKEN = xapp-def ",
          "# trailing comment",
        ].join("\n"),
      },
    })
    const reader = new FunnelDotenvReader({ fs })

    expect(reader.read("/repo")).toEqual({
      SLACK_BOT_TOKEN: "xoxb-abc",
      SLACK_APP_TOKEN: "xapp-def",
    })
  })

  test("strips matching quotes", () => {
    const fs = new MemoryFunnelFileSystem({
      files: {
        "/repo/.env.local": [
          'A="double"',
          "B='single'",
          'C="mismatched\'',
        ].join("\n"),
      },
    })
    const reader = new FunnelDotenvReader({ fs })

    expect(reader.read("/repo")).toEqual({
      A: "double",
      B: "single",
      C: "\"mismatched'",
    })
  })
})
