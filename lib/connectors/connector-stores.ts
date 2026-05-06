import { FunnelDiscordStore } from "@/connectors/discord-store";
import { FunnelGhStore } from "@/connectors/gh-store";
import { FunnelScheduleStore } from "@/connectors/schedule-store";
import { FunnelSlackStore } from "@/connectors/slack-store";
import { FunnelFileSystem } from "@/engine/fs/file-system";
import { FunnelIdGenerator } from "@/engine/id/id-generator";
import { FunnelLogger } from "@/engine/logger/logger";
import { FunnelProcessRunner } from "@/engine/process/process-runner";
import { FunnelClock } from "@/engine/time/clock";

export type ConnectorStoresBundle = {
  slack: FunnelSlackStore;
  gh: FunnelGhStore;
  discord: FunnelDiscordStore;
  schedule: FunnelScheduleStore;
};

type Deps = {
  fs?: FunnelFileSystem;
  process?: FunnelProcessRunner;
  logger?: FunnelLogger;
  clock?: FunnelClock;
  idGenerator?: FunnelIdGenerator;
  dir?: string;
};

export const createConnectorStores = (deps: Deps = {}): ConnectorStoresBundle => ({
  slack: new FunnelSlackStore({
    fs: deps.fs,
    dir: deps.dir,
    logger: deps.logger,
    clock: deps.clock,
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
    clock: deps.clock,
  }),
  schedule: new FunnelScheduleStore({
    fs: deps.fs,
    dir: deps.dir,
    logger: deps.logger,
    idGenerator: deps.idGenerator,
    clock: deps.clock,
  }),
});
