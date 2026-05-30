import { existsSync } from "node:fs"
import { join } from "node:path"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import { ConnectorDiagnosticSqlReader } from "@/gateway/connector-diagnostic-sql-reader"

export const sqlHelp = `funnel gateway sql — query inbound connector traffic with SQL

usage: funnel gateway sql --query "<SELECT ...>"

Runs one read-only SELECT against the daemon's diagnostic store of inbound
connector events and prints the rows as JSON. Use it to answer "Slack
delivered an event, so why was there no notification?".

Three views:
  raw         every inbound event, untouched, before any filtering
  processed   the verdict for that event after the per-type processor ran
  connection  the listener lifecycle (so you can tell events never arrived)

Shared columns (all three views):
  seq           row id within the view (not comparable across views)
  ts            epoch milliseconds
  type          connector kind: slack | discord | gh | schedule
  connector_id  funnel connector id
  channel_id    funnel channel id
raw and processed also have:
  event_id      correlation id shared by an event's raw and processed rows
  payload       raw: the original event JSON (text); processed: the delivered body, or "" when skipped
processed also has:
  outcome       'emitted' | 'emitted:delivery-failed' | 'skip:<reason>'
                (skip reasons: skip:type, skip:subtype, skip:dedup,
                 skip:self-user, skip:self-bot, skip:preprocess)
connection also has:
  status        'started' | 'connected' | 'disconnected' | 'auth-failed' | 'stopped' | 'error'
  detail        an error message or reason, or "" when none

To trace one event end to end, join raw and processed on event_id. When the
event tables are empty, query connection — a listener that never connected, or
failed auth, explains why nothing arrived.

examples:
  funnel gateway sql --query "SELECT event_id, ts, type FROM raw ORDER BY seq DESC LIMIT 20"
  funnel gateway sql --query "SELECT outcome, COUNT(*) n FROM processed GROUP BY outcome"
  funnel gateway sql --query "SELECT r.payload FROM raw r JOIN processed p USING(event_id) WHERE p.outcome='skip:dedup'"
  funnel gateway sql --query "SELECT ts, status, detail FROM connection WHERE status IN ('auth-failed','error') ORDER BY seq DESC"`

export const gatewaySqlHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      query: z.string().optional(),
    }),
    sqlHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const sql = query.query

    if (!sql) return c.text(sqlHelp)

    const tmpDir = funnelTmpDir()
    const rawPath = join(tmpDir, "connector-raw.db")
    const processedPath = join(tmpDir, "connector-processed.db")
    const connectionPath = join(tmpDir, "connector-connection.db")

    // The daemon creates all three files together on boot, so the raw file's
    // absence means the gateway has never initialized the diagnostic store.
    if (!existsSync(rawPath) || !existsSync(processedPath) || !existsSync(connectionPath)) {
      return c.text("no diagnostic store yet (the gateway has not initialized it)")
    }

    const reader = new ConnectorDiagnosticSqlReader({ rawPath, processedPath, connectionPath })

    const rows = (() => {
      try {
        return reader.query(sql)
      } finally {
        reader.close()
      }
    })()

    if (rows instanceof Error) return c.text(`error: ${rows.message}`)

    return c.text(JSON.stringify(rows, null, 2))
  },
)
