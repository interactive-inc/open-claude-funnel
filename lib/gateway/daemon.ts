#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createConnectorStores } from "@/connectors/connector-stores";
import { migrateLegacyConnectors } from "@/connectors/migrate-legacy-connectors";
import { FUNNEL_DIR } from "@/engine/settings/settings-store";
import { Funnel } from "@/funnel";
import { NodeFunnelLogger } from "@/engine/logger/node-logger";

const PORT = Number(process.env.FUNNEL_PORT) || 9742;
const PID_FILE = join(FUNNEL_DIR, "gateway.pid");
const LOG_DIR = "/tmp/funnel/events";

const logger = new NodeFunnelLogger();

mkdirSync(FUNNEL_DIR, { recursive: true });

if (existsSync(PID_FILE)) {
  const existing = Number(readFileSync(PID_FILE, "utf-8").trim());

  if (existing > 0) {
    const check = Bun.spawnSync(["ps", "-p", String(existing), "-o", "state="], {
      stdout: "pipe",
      stderr: "pipe",
    });

    if (check.exitCode === 0 && check.stdout.toString().trim()) {
      logger.error("funnel gateway already running", { pid: existing });
      process.exit(1);
    }
  }
}

writeFileSync(PID_FILE, String(process.pid));

process.on("exit", () => {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // ignore
  }
});
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));

const connectorStores = createConnectorStores();

migrateLegacyConnectors({ stores: connectorStores });

const funnel = new Funnel({ connectorStores, logger });
const server = funnel.gatewayServer({ port: PORT, logDir: LOG_DIR });

await server.start();
