import type { FlumeStatePersister } from "@interactive-inc/flume"
import { dirname, join } from "node:path"
import type { FunnelFileSystem } from "@/engine/fs/file-system"

type Props = {
  readonly fs: FunnelFileSystem
  readonly path: string
}

/**
 * `FunnelFileSystem` 上に JSON で 1 行 / 1 状態を保存する `FlumeStatePersister`。
 * 保存先ディレクトリは load/save の前に再帰作成する。
 * load は不在 / parse 失敗時に `null` を返す (flume 側で素直に「初回扱い」になる)
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

type DirProps = {
  readonly fs: FunnelFileSystem
  /** `<funnelDir>/channels/<channelId>` の絶対パス */
  readonly channelDir: string
}

/**
 * channel 単位の state persister ファクトリ。`statePersister<S>("time")` を呼ぶと
 * `<channelDir>/time.json` 用の persister を返す
 */
export function createChannelStatePersisterFactory(
  props: DirProps,
): <S>(filename: string) => FlumeStatePersister<S> {
  return (filename) =>
    createFileStatePersister({
      fs: props.fs,
      path: join(props.channelDir, `${filename}.json`),
    })
}
