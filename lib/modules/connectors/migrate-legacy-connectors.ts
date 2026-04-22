import { join } from "node:path"
import { connectorConfigSchema } from "@/modules/connectors/connector-config-schema"
import type { ConnectorStoresBundle } from "@/modules/connectors/funnel-connector-stores"
import { DEFAULT_FUNNEL_DIR } from "@/modules/connectors/funnel-json-connector-store"
import { FunnelFileSystem } from "@/modules/fs/funnel-file-system"
import { NodeFunnelFileSystem } from "@/modules/fs/node-funnel-file-system"
import { logger } from "@/modules/logger"

type Props = {
  stores: ConnectorStoresBundle
  fs?: FunnelFileSystem
  dir?: string
}

const defaultFs = new NodeFunnelFileSystem()

export const migrateLegacyConnectors = (props: Props): number => {
  const fs = props.fs ?? defaultFs
  const base = props.dir ?? DEFAULT_FUNNEL_DIR
  const path = join(base, "settings.json")

  if (!fs.existsSync(path)) return 0

  const content = fs.readFileSync(path)
  const raw = JSON.parse(content) as Record<string, unknown>
  const legacy = raw.connectors

  if (!Array.isArray(legacy) || legacy.length === 0) {
    if (legacy !== undefined) {
      const stripped = { ...raw }
      delete stripped.connectors
      fs.writeFileSync(path, `${JSON.stringify(stripped, null, 2)}\n`)
    }
    return 0
  }

  let migrated = 0

  for (const entry of legacy) {
    const parsed = connectorConfigSchema.safeParse(entry)

    if (!parsed.success) {
      logger.warn("skipping invalid legacy connector", {
        error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", "),
      })
      continue
    }

    const config = parsed.data

    if (config.type === "slack") {
      if (props.stores.slack.has(config.name)) continue
      props.stores.slack.add(config)
    } else if (config.type === "gh") {
      if (props.stores.gh.has(config.name)) continue
      props.stores.gh.add(config)
    } else if (config.type === "discord") {
      if (props.stores.discord.has(config.name)) continue
      props.stores.discord.add(config)
    } else {
      if (props.stores.schedule.has(config.name)) continue
      props.stores.schedule.add(config)
    }

    migrated++
  }

  const stripped = { ...raw }
  delete stripped.connectors
  fs.writeFileSync(path, `${JSON.stringify(stripped, null, 2)}\n`)

  if (migrated > 0) {
    logger.info("migrated legacy connectors from settings.json", { count: migrated })
  }

  return migrated
}
