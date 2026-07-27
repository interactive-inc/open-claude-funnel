import { homedir } from "node:os"
import { join } from "node:path"
import type { FunnelFileSystem } from "@/engine/fs/file-system"

type Props = {
  fs: FunnelFileSystem
  cwd: string
  sessionId: string
  env: Record<string, string>
}

/**
 * Checks the Claude session path selected by the launch environment and rejects
 * empty jsonl files that Claude itself cannot resume.
 */
export function sessionFileExists(props: Props): boolean {
  const configDir =
    props.env.CLAUDE_CONFIG_DIR ??
    globalThis.process.env.CLAUDE_CONFIG_DIR ??
    join(homedir(), ".claude")
  const projectSlug = props.cwd.replace(/\//g, "-")
  const path = join(configDir, "projects", projectSlug, `${props.sessionId}.jsonl`)

  if (!props.fs.existsSync(path)) return false

  return props.fs.readFileSync(path).trim().length > 0
}
