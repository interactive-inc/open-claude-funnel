import { describe, expect, test } from "bun:test"
import { resolveRepoDir } from "@/cli/resolve-repo-dir"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { MemoryFunnelIdGenerator } from "@/engine/id/memory-id-generator"
import { FunnelLocalConfig } from "@/engine/local-config/local-config"
import { FunnelLocalConfigWriter } from "@/engine/local-config/local-config-writer"

const build = (opts: { files?: Record<string, string> } = {}) => {
  const fs = new MemoryFunnelFileSystem({ files: opts.files })
  const idGenerator = new MemoryFunnelIdGenerator({ prefix: "uuid" })

  const deps = {
    localConfig: new FunnelLocalConfig({ fs }),
    writer: new FunnelLocalConfigWriter({ fs }),
    idGenerator,
    home: "/home",
  }

  return { fs, idGenerator, deps }
}

describe("resolveRepoDir", () => {
  test("returns null when there is no funnel.json", () => {
    const { deps } = build()

    expect(resolveRepoDir(deps, "/repo")).toBeNull()
  })

  test("generates an id, scopes to ~/.funnel/projects/<id>, and writes it back", () => {
    const { fs, deps } = build({
      files: { "/repo/funnel.json": JSON.stringify({ channels: [{ name: "ops" }] }) },
    })

    const dir = resolveRepoDir(deps, "/repo")

    expect(dir).toEqual("/home/.funnel/projects/uuid-1")
    expect(JSON.parse(fs.readFileSync("/repo/funnel.json")).id).toEqual("uuid-1")
  })

  test("reuses an existing id without regenerating or rewriting", () => {
    const { fs, idGenerator, deps } = build({
      files: { "/repo/funnel.json": JSON.stringify({ id: "fixed", channels: [{ name: "ops" }] }) },
    })

    const dir = resolveRepoDir(deps, "/repo")

    expect(dir).toEqual("/home/.funnel/projects/fixed")
    // The id generator was never consulted: a first generate() still returns uuid-1.
    expect(idGenerator.generate()).toEqual("uuid-1")
    expect(JSON.parse(fs.readFileSync("/repo/funnel.json")).id).toEqual("fixed")
  })

  test("propagates a read error from an invalid funnel.json", () => {
    const { deps } = build({
      files: { "/repo/funnel.json": JSON.stringify({ channels: [] }) },
    })

    expect(() => resolveRepoDir(deps, "/repo")).toThrow(/is invalid/)
  })
})
