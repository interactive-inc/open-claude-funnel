import type { FlumeStatePersister } from "@interactive-inc/flume"
import { join } from "node:path"
import type { FunnelFileSystem } from "@/engine/fs/file-system"
import { createFileStatePersister } from "@/engine/channel/file-state-persister"

type Props = {
  readonly fs: FunnelFileSystem
  /** Absolute path of `<funnelDir>/channels/<channelId>` */
  readonly channelDir: string
}

/**
 * Per-channel state persister factory: `statePersister<S>("time")` returns a
 * persister bound to `<channelDir>/time.json`
 */
export function createChannelStatePersisterFactory(
  props: Props,
): <S>(filename: string) => FlumeStatePersister<S> {
  return (filename) =>
    createFileStatePersister({
      fs: props.fs,
      path: join(props.channelDir, `${filename}.json`),
    })
}
