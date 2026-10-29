import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { posix } from "node:path"
import { execFileSync } from "node:child_process"

// Inspect publication contents without lifecycle scripts or publishing.
// Windows distributes npm as npm.cmd; Node cannot execFile a command script directly.
const packCommand = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm"
const packArgs =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npm pack --dry-run --json --ignore-scripts"]
    : ["pack", "--dry-run", "--json", "--ignore-scripts"]
const [pack] = JSON.parse(execFileSync(packCommand, packArgs, { encoding: "utf8" }))
const shipped = new Set(pack.files.map((file) => file.path))
const pkg = JSON.parse(await readFile("package.json", "utf8"))
assert.equal(pkg.bin, undefined, "Funnel must remain an embedded library")
for (const name of ["@anthropic-ai/claude-agent-sdk", "@modelcontextprotocol/sdk"]) {
  assert.equal(pkg.dependencies?.[name], undefined, "SDK and MCP ownership belongs to the host")
}

function checkExport(value) {
  if (typeof value === "string") {
    assert(shipped.has(value.replace(/^\.\//, "")), `Missing exported file: ${value}`)
  } else {
    for (const entry of Object.values(value)) checkExport(entry)
  }
}
for (const value of Object.values(pkg.exports)) checkExport(value)

const documents = new Set()
const pending = ["README.md"]
while (pending.length) {
  const file = pending.pop()
  if (documents.has(file)) continue
  assert(shipped.has(file), `Missing linked document: ${file}`)
  documents.add(file)
  const body = await readFile(file, "utf8")
  for (const [, link] of body.matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(?:[a-z]+:|#)/i.test(link)) continue
    const target = posix.normalize(posix.join(posix.dirname(file), link.split("#")[0]))
    assert(shipped.has(target), `Broken installed-package link: ${file} -> ${link}`)
    if (target.endsWith(".md")) pending.push(target)
  }
}
console.log(
  `Package verified: ${shipped.size} files, ${documents.size} linked documents, ${pack.size} packed bytes`,
)
