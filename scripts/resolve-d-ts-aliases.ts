import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join, relative } from "node:path"

const DIST = new URL("../dist", import.meta.url).pathname

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true })

  for (const entry of entries) {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      yield* walk(path)
      continue
    }

    if (entry.name.endsWith(".d.ts")) yield path
  }
}

function rewrite(content: string, fromDir: string): string {
  const replaceAlias = (_: string, pre: string, sub: string, post: string): string => {
    const target = join(DIST, sub)
    const raw = relative(fromDir, target) || "."
    const rel = raw.startsWith(".") ? raw : `./${raw}`

    return `${pre}${rel}${post}`
  }

  return content
    .replace(/(from\s+["'])@\/([^"']+)(["'])/g, replaceAlias)
    .replace(/(import\s*\(\s*["'])@\/([^"']+)(["'])/g, replaceAlias)
}

let rewritten = 0

for await (const file of walk(DIST)) {
  const content = await readFile(file, "utf8")
  const next = rewrite(content, dirname(file))

  if (next === content) continue

  await writeFile(file, next)
  rewritten += 1
}

console.log(`resolved @/ aliases in ${rewritten} .d.ts files`)
