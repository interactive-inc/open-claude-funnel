import type { FlumeStatePersister } from "@interactive-inc/flume"
import { dirname } from "node:path"
import type { FunnelFileSystem } from "@/engine/fs/file-system"

type Props = {
  readonly fs: FunnelFileSystem
  readonly path: string
}

/**
 * `FlumeStatePersister` storing one JSON document per file on top of
 * `FunnelFileSystem`. The target directory is created recursively before save.
 * load returns `null` when the file is absent, empty, or unparsable (flume
 * then treats the source as first-run)
 */
export function createFileStatePersister<S>(props: Props): FlumeStatePersister<S> {
  return {
    async load(): Promise<S | null> {
      if (!props.fs.existsSync(props.path)) return null

      const raw = props.fs.readFileSync(props.path)
      if (raw === "") return null

      try {
        return JSON.parse(raw) as S
      } catch {
        return null
      }
    },

    async save(state: S): Promise<void> {
      const dir = dirname(props.path)
      if (!props.fs.existsSync(dir)) {
        props.fs.mkdirSync(dir, { recursive: true })
      }
      props.fs.writeFileSync(props.path, JSON.stringify(state))
    },
  }
}
