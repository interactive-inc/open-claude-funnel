import { join } from "node:path"
import { FunnelFileSystem } from "@/engine/fs/file-system"

/**
 * Guarantees `<cwd>/.gitignore` ignores the given entry. A funnel.json launch
 * writes its state into `<repo>/.funnel`; that dir is repo-local runtime state
 * (settings, gateway pid/token, claude pids) and must never be committed, so
 * we append the rule on every launch if it is not already covered.
 *
 * Matching is line-based against the trimmed entry (`.funnel`, `.funnel/`, or a
 * leading-slash form). A surrounding `*`/glob rule is not detected; the cost of
 * a duplicate line is nil, a leaked secret is not, so we err toward appending.
 */
export const ensureGitignored = (fs: FunnelFileSystem, cwd: string, entry: string): void => {
  const path = join(cwd, ".gitignore")
  const accepted = new Set([entry, `${entry}/`, `/${entry}`, `/${entry}/`])

  if (!fs.existsSync(path)) {
    fs.writeFileSync(path, `${entry}\n`)

    return
  }

  const content = fs.readFileSync(path)

  for (const raw of content.split("\n")) {
    if (accepted.has(raw.trim())) return
  }

  const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : ""

  fs.appendFileSync(path, `${separator}${entry}\n`)
}
