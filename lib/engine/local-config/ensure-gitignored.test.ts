import { describe, expect, test } from "bun:test"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { ensureGitignored } from "@/engine/local-config/ensure-gitignored"

describe("ensureGitignored", () => {
  test("creates .gitignore with the entry when none exists", () => {
    const fs = new MemoryFunnelFileSystem({ dirs: ["/repo"] })

    ensureGitignored(fs, "/repo", ".funnel")

    expect(fs.readFileSync("/repo/.gitignore")).toEqual(".funnel\n")
  })

  test("appends the entry when the file lacks it", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/.gitignore": "node_modules\ndist\n" },
      dirs: ["/repo"],
    })

    ensureGitignored(fs, "/repo", ".funnel")

    expect(fs.readFileSync("/repo/.gitignore")).toEqual("node_modules\ndist\n.funnel\n")
  })

  test("inserts a newline before appending when the file lacks a trailing one", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/.gitignore": "node_modules" },
      dirs: ["/repo"],
    })

    ensureGitignored(fs, "/repo", ".funnel")

    expect(fs.readFileSync("/repo/.gitignore")).toEqual("node_modules\n.funnel\n")
  })

  test("is a no-op when the entry is already present", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/.gitignore": "node_modules\n.funnel\ndist\n" },
      dirs: ["/repo"],
    })

    ensureGitignored(fs, "/repo", ".funnel")

    expect(fs.readFileSync("/repo/.gitignore")).toEqual("node_modules\n.funnel\ndist\n")
  })

  test("treats .funnel/ and /.funnel as already covering .funnel", () => {
    const fs = new MemoryFunnelFileSystem({
      files: { "/repo/.gitignore": ".funnel/\n" },
      dirs: ["/repo"],
    })

    ensureGitignored(fs, "/repo", ".funnel")

    expect(fs.readFileSync("/repo/.gitignore")).toEqual(".funnel/\n")
  })
})
