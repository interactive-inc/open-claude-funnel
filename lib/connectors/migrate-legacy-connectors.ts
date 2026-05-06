import { join } from "node:path";
import { connectorConfigSchema } from "@/connectors/connector-config-schema";
import type { ConnectorStoresBundle } from "@/connectors/connector-stores";
import { DEFAULT_FUNNEL_DIR } from "@/connectors/json-connector-store";
import { FunnelFileSystem } from "@/engine/fs/file-system";
import { NodeFunnelFileSystem } from "@/engine/fs/node-file-system";
import { FunnelLogger } from "@/engine/logger/logger";
import { NodeFunnelLogger } from "@/engine/logger/node-logger";

type Props = {
  stores: ConnectorStoresBundle;
  fs?: FunnelFileSystem;
  dir?: string;
  logger?: FunnelLogger;
};

const defaultFs = new NodeFunnelFileSystem();
const defaultLogger = new NodeFunnelLogger();

export const migrateLegacyConnectors = (props: Props): number => {
  const fs = props.fs ?? defaultFs;
  const base = props.dir ?? DEFAULT_FUNNEL_DIR;
  const path = join(base, "settings.json");
  const logger = props.logger ?? defaultLogger;

  if (!fs.existsSync(path)) return 0;

  const content = fs.readFileSync(path);
  const raw: unknown = JSON.parse(content);

  if (raw === null || typeof raw !== "object") return 0;

  const legacy = "connectors" in raw ? raw.connectors : undefined;
  const stripConnectors = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(raw)) {
      if (key !== "connectors") out[key] = value;
    }

    return out;
  };

  if (!Array.isArray(legacy) || legacy.length === 0) {
    if (legacy !== undefined) {
      fs.writeFileSync(path, `${JSON.stringify(stripConnectors(), null, 2)}\n`);
    }
    return 0;
  }

  let migrated = 0;

  for (const entry of legacy) {
    const parsed = connectorConfigSchema.safeParse(entry);

    if (!parsed.success) {
      logger.warn("skipping invalid legacy connector", {
        error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
      });
      continue;
    }

    const config = parsed.data;

    if (config.type === "slack") {
      if (props.stores.slack.has(config.name)) continue;
      props.stores.slack.add(config);
    } else if (config.type === "gh") {
      if (props.stores.gh.has(config.name)) continue;
      props.stores.gh.add(config);
    } else if (config.type === "discord") {
      if (props.stores.discord.has(config.name)) continue;
      props.stores.discord.add(config);
    } else {
      if (props.stores.schedule.has(config.name)) continue;
      props.stores.schedule.add(config);
    }

    migrated++;
  }

  fs.writeFileSync(path, `${JSON.stringify(stripConnectors(), null, 2)}\n`);

  if (migrated > 0) {
    logger.info("migrated legacy connectors from settings.json", { count: migrated });
  }

  return migrated;
};
