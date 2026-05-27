#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { FUNNEL_DIR } from "@/engine/settings/settings-store"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import { Funnel } from "@/funnel"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { SqliteConnectorDiagnosticLog } from "@/gateway/sqlite-connector-diagnostic-log"

/** Cap on diagnostic rows per table — enough history to debug a flaky day without unbounded growth. */
const RAW_LOG_MAX_ROWS = 50_000

const PORT = Number(process.env.FUNNEL_PORT) || 9742
const PID_FILE = join(FUNNEL_DIR, "gateway.pid")

// process.title is honored on POSIX (visible in `ps -o args=`) and a no-op
// on Windows; the argv-appended `funnel-gateway[<dir>]` marker covers both.
process.title = `funnel-gateway[${FUNNEL_DIR}]`

const logger = new NodeFunnelLogger()
const processRunner = new NodeFunnelProcessRunner()

mkdirSync(FUNNEL_DIR, { recursive: true })

if (existsSync(PID_FILE)) {
  const existing = Number(readFileSync(PID_FILE, "utf-8").trim())

  if (existing > 0 && processRunner.isAlive(existing)) {
    logger.error("funnel gateway already running", { pid: existing })
    process.exit(1)
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

const tmpDir = funnelTmpDir()
mkdirSync(tmpDir, { recursive: true })

const diagnosticLog = new SqliteConnectorDiagnosticLog({
  rawPath: join(tmpDir, "connector-raw.db"),
  processedPath: join(tmpDir, "connector-processed.db"),
  connectionPath: join(tmpDir, "connector-connection.db"),
  maxRows: RAW_LOG_MAX_ROWS,
})

const funnel = new Funnel({ logger, diagnosticLog })
const server = funnel.gatewayServer({ port: PORT })

await server.start()
