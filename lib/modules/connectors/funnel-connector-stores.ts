import { FunnelDiscordStore } from "@/modules/connectors/funnel-discord-store"
import { FunnelGhStore } from "@/modules/connectors/funnel-gh-store"
import { FunnelScheduleStore } from "@/modules/connectors/funnel-schedule-store"
import { FunnelSlackStore } from "@/modules/connectors/funnel-slack-store"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { FunnelIdGenerator } from "@/modules/id/funnel-id-generator"
import { FunnelLogger } from "@/modules/logger/funnel-logger"
import { FunnelProcessRunner } from "@/modules/process/funnel-process-runner"
import { FunnelClock } from "@/modules/time/funnel-clock"

export type ConnectorStoresBundle = {
  slack: FunnelSlackStore
  gh: FunnelGhStore
  discord: FunnelDiscordStore
  schedule: FunnelScheduleStore
}

type Deps = {
  fs?: FunnelFileSystem
  process?: FunnelProcessRunner
  logger?: FunnelLogger
  clock?: FunnelClock
  idGenerator?: FunnelIdGenerator
  dir?: string
}

export const createConnectorStores = (deps: Deps = {}): ConnectorStoresBundle => ({
  slack: new FunnelSlackStore({
    fs: deps.fs,
    dir: deps.dir,
    logger: deps.logger,
  }),
  gh: new FunnelGhStore({
    fs: deps.fs,
    dir: deps.dir,
    process: deps.process,
    logger: deps.logger,
    clock: deps.clock,
  }),
  discord: new FunnelDiscordStore({
    fs: deps.fs,
    dir: deps.dir,
    logger: deps.logger,
  }),
  schedule: new FunnelScheduleStore({
    fs: deps.fs,
    dir: deps.dir,
    logger: deps.logger,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  }),
})
