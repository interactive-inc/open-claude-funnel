#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { FunnelChannels } from "@/modules/channels/funnel-channels"
import { FunnelConnectors } from "@/modules/connectors/funnel-connectors"
import { createConnectorStores } from "@/modules/connectors/funnel-connector-stores"
import { migrateLegacyConnectors } from "@/modules/connectors/migrate-legacy-connectors"
import { FunnelGatewayServer } from "@/modules/gateway/funnel-gateway-server"
import { NodeFunnelLogger } from "@/modules/logger/node-funnel-logger"
import { FunnelProfiles } from "@/modules/profiles/funnel-profiles"
import { FUNNEL_DIR, FunnelSettingsStore } from "@/modules/settings/funnel-settings-store"

const PORT = Number(process.env.FUNNEL_PORT) || 9742
const PID_FILE = join(FUNNEL_DIR, "gateway.pid")
const LOG_DIR = "/tmp/funnel/events"

const logger = new NodeFunnelLogger()

mkdirSync(FUNNEL_DIR, { recursive: true })

if (existsSync(PID_FILE)) {
  const existing = Number(readFileSync(PID_FILE, "utf-8").trim())

  if (existing > 0) {
    const check = Bun.spawnSync(["ps", "-p", String(existing), "-o", "state="], {
      stdout: "pipe",
      stderr: "pipe",
    })

    if (check.exitCode === 0 && check.stdout.toString().trim()) {
      logger.error(`funnel gateway already running`, { pid: existing })
      process.exit(1)
    }
  }
}

writeFileSync(PID_FILE, String(process.pid))

process.on("exit", () => {
  try {
    unlinkSync(PID_FILE)
  } catch {
    // ignore
  }
})
process.on("SIGINT", () => process.exit(130))
process.on("SIGTERM", () => process.exit(143))

const store = new FunnelSettingsStore()
const connectorStores = createConnectorStores()

migrateLegacyConnectors({ stores: connectorStores })

const profiles = new FunnelProfiles({ store })
const channels: FunnelChannels = new FunnelChannels({
  store,
  connectorChecker: { has: (name: string) => connectors.has(name) },
  profileChecker: profiles,
  profileRefUpdater: profiles,
})
const connectors: FunnelConnectors = new FunnelConnectors({
  ...connectorStores,
  refUpdater: channels,
})

const server = new FunnelGatewayServer({
  connectors,
  settings: store,
  port: PORT,
  logDir: LOG_DIR,
  logger,
})

await server.start()
