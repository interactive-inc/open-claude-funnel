import { existsSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/engine/yaml/yaml-render"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import { ConnectorDiagnosticSqlReader } from "@/engine/diagnostic-log/diagnostic-sql-reader"

export const PRESETS: Record<string, string> = {
  recent: "SELECT seq, ts, type, outcome FROM processed ORDER BY seq DESC LIMIT 20",
  skipped:
    "SELECT seq, ts, type, outcome, payload FROM processed WHERE outcome LIKE 'skip:%' ORDER BY seq DESC LIMIT 20",
  errors:
    "SELECT ts, status, detail FROM connection WHERE status IN ('auth-failed','error') ORDER BY seq DESC LIMIT 20",
  summary: "SELECT outcome, COUNT(*) AS count FROM processed GROUP BY outcome ORDER BY count DESC",
  "trace-dedup":
    "SELECT r.seq, r.ts, r.event_id, r.payload FROM raw r JOIN processed p USING(event_id) WHERE p.outcome='skip:dedup' ORDER BY r.seq DESC LIMIT 20",
}

// Channel-filtered variants. A regex that injects `WHERE channel_id = ?` into
// the base presets broke whenever the base already had a WHERE (skipped/errors
// → double WHERE) or a table alias (trace-dedup → split `raw r`). Each preset
// instead carries a hand-written `channel_id = ?` placed correctly (AND vs
// WHERE, aliased for the join). Keys must stay in sync with PRESETS.
export const PRESETS_BY_CHANNEL: Record<string, string> = {
  recent:
    "SELECT seq, ts, type, outcome FROM processed WHERE channel_id = ? ORDER BY seq DESC LIMIT 20",
  skipped:
    "SELECT seq, ts, type, outcome, payload FROM processed WHERE channel_id = ? AND outcome LIKE 'skip:%' ORDER BY seq DESC LIMIT 20",
  errors:
    "SELECT ts, status, detail FROM connection WHERE channel_id = ? AND status IN ('auth-failed','error') ORDER BY seq DESC LIMIT 20",
  summary:
    "SELECT outcome, COUNT(*) AS count FROM processed WHERE channel_id = ? GROUP BY outcome ORDER BY count DESC",
  "trace-dedup":
    "SELECT r.seq, r.ts, r.event_id, r.payload FROM raw r JOIN processed p USING(event_id) WHERE r.channel_id = ? AND p.outcome='skip:dedup' ORDER BY r.seq DESC LIMIT 20",
}

const sqlHelp = `funnel gateway sql — query inbound connector traffic with SQL

usage: funnel gateway sql --preset <name> [--channel <name|id>] [--limit <N>]
       funnel gateway sql --query "<SELECT ...>"

options:
  --preset <name>       run a named preset (quickest starting point)
  --channel <name|id>   filter preset results by channel name or id
  --limit <N>           override the row limit for presets (default: 20)
  --query "<SQL>"       run a custom SELECT; output is JSON

quick-start presets (--preset <name>):
  recent        last N processed events — type, outcome, preview
  skipped       last N events filtered out (skip:*) — see why events were dropped
  errors        listener auth-failed or error events — start here for connection failures
  summary       outcome counts grouped by type — high-level health snapshot (no limit)
  trace-dedup   raw payload of events dropped as duplicates

Output is always JSON — pipe to jq or pass directly to Claude.

three SQL views (for --query):
  raw         every inbound event before filtering (payload = original JSON)
  processed   filter verdict per event (outcome: emitted | skip:<reason>)
  connection  listener lifecycle (status: connected | auth-failed | error | ...)

common join: SELECT r.payload FROM raw r JOIN processed p USING(event_id) WHERE p.outcome = 'skip:dedup'

skip reasons: skip:type  skip:subtype  skip:dedup  skip:self-user  skip:self-bot  skip:preprocess

examples:
  funnel gateway sql --preset recent
  funnel gateway sql --preset recent --limit 100
  funnel gateway sql --preset skipped --channel open-karte
  funnel gateway sql --preset errors
  funnel gateway sql --preset summary
  funnel gateway sql --query "SELECT outcome, COUNT(*) n FROM processed GROUP BY outcome"

tip: for a higher-level view without writing SQL, use: fnl debug --channel <name> --json

see also: fnl debug, fnl gateway logs

programmable: const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })
              reader.query("SELECT …")
              — but for most cases, funnel.diagnostics.recentEvents() / .droppedEvents()
              / .connectionErrors() are higher level and don't need SQL.`

export const gatewaySqlHandler = factory.createHandlers(
  helpGuard(sqlHelp),
  zValidator(
    "query",
    z.object({
      query: z.string().optional(),
      preset: z.enum(Object.keys(PRESETS) as [string, ...string[]]).optional(),
      channel: z.string().optional(),
      limit: z.string().optional(),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel

    let sql: string | null = null
    let params: (string | number | null)[] = []

    let resolvedChannelId: string | null = null

    if (query.channel) {
      const channels = funnel.channels.list()
      const match = channels.find((ch) => ch.id === query.channel || ch.name === query.channel)

      resolvedChannelId = match?.id ?? query.channel
    }

    if (query.preset) {
      const base = resolvedChannelId
        ? (PRESETS_BY_CHANNEL[query.preset] ?? null)
        : (PRESETS[query.preset] ?? null)

      if (!base) return c.text(sqlHelp)

      let applied = base

      if (query.limit) {
        const n = Math.max(1, Number(query.limit))

        applied = applied.replace(/LIMIT \d+/, `LIMIT ${n}`)
      }

      sql = applied
      params = resolvedChannelId ? [resolvedChannelId] : []
    } else if (query.query) {
      sql = query.query
    }

    if (!sql) return c.text(sqlHelp)

    const tmpDir = funnelTmpDir()
    const rawPath = join(tmpDir, "connector-raw.db")
    const processedPath = join(tmpDir, "connector-processed.db")
    const connectionPath = join(tmpDir, "connector-connection.db")

    if (!existsSync(rawPath) || !existsSync(processedPath) || !existsSync(connectionPath)) {
      return c.text("no diagnostic store yet (the gateway has not initialized it)")
    }

    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const rows = (() => {
      try {
        return reader.query(sql as string, params)
      } finally {
        reader.close()
      }
    })()

    if (rows instanceof Error) return c.text(renderYaml({ error: rows.message }))

    return c.text(renderYaml({ rows }))
  },
)
