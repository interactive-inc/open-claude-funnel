import { readdirSync } from "node:fs"
import { join, relative } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

if (!process.versions.bun) throw new Error("Run this check with Bun")

const root = fileURLToPath(new URL("../", import.meta.url))
const files = []
const collect = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) collect(path)
    else if (entry.isFile() && /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name))
      files.push(relative(root, path))
  }
}
collect(join(root, "lib"))
files.sort()

// Isolate native cancellation tests from global fetch mocks without skipping tests.
// Old Bun runtimes may still crash in isolation; preserve that failure below.
const isolated = join("lib", "engine", "http", "node-http-client.test.ts")
if (!files.includes(isolated)) throw new Error("HTTP cancellation test file is missing")
const shared = files.filter((path) => path !== isolated)
if (shared.length === 0) throw new Error("No library tests found")

console.log(`Checking ${files.length} test files with Bun ${process.versions.bun} in two groups`)
for (const group of [shared, [isolated]]) {
  const result = spawnSync(process.execPath, ["test", ...group], { cwd: root, stdio: "inherit" })
  if (result.error) throw result.error
  if (result.signal)
    throw new Error(
      `Minimum Bun ${group === shared ? "library" : "HTTP cancellation"} checks terminated by ${result.signal}`,
    )
  if (result.status !== 0) process.exit(result.status ?? 1)
}
