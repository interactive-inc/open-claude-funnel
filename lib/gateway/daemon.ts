#!/usr/bin/env bun
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { resolveFunnelDir, resolveFunnelPort } from "@/engine/settings/settings-store"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"
import { Funnel } from "@/funnel"
import { NodeFunnelLogger } from "@/engine/logger/node-logger"
import { SqliteConnectorDiagnosticLog } from "@/gateway/sqlite-connector-diagnostic-log"

// Raw rows can each hold up to ~256 KiB, so they get a tight cap (~5k rows ≈
// 1.3 GiB worst case); the small verdict/lifecycle rows get a looser one.
const RAW_MAX_ROWS = 5_000
const VERDICT_MAX_ROWS = 50_000
// Untouched payloads carry PII (message text, user ids); bound how long they
// live on disk regardless of volume.
const DIAGNOSTIC_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

const PORT = resolveFunnelPort()
// Loopback by default; set FUNNEL_HOST=0.0.0.0 to expose the gateway on the LAN
// (e.g. agents on other machines). The bearer token still gates every endpoint.
const HOST = process.env.FUNNEL_HOST || "127.0.0.1"
// Honors a FUNNEL_DIR override (a funnel.json-scoped launch points this at
// <repo>/.funnel), falling back to ~/.funnel.
const funnelDir = resolveFunnelDir()
const PID_FILE = join(funnelDir, "gateway.pid")

// process.title is honored on POSIX (visible in `ps -o args=`) and a no-op
// on Windows; the argv-appended `funnel-gateway[<dir>]` marker covers both.
process.title = `funnel-gateway[${funnelDir}]`

const logger = new NodeFunnelLogger()
const processRunner = new NodeFunnelProcessRunner()

mkdirSync(funnelDir, { recursive: true })

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
  rawMaxRows: RAW_MAX_ROWS,
  maxRows: VERDICT_MAX_ROWS,
  maxAgeMs: DIAGNOSTIC_MAX_AGE_MS,
  logger,
})

// Close the WAL handles on shutdown so the sidecar files are checkpointed.
// `exit` fires synchronously after the SIGINT/SIGTERM handlers call exit(),
// and close() is synchronous, so this runs cleanly.
process.on("exit", () => {
  try {
    diagnosticLog.close()
  } catch {
    // ignore
  }
})

const funnel = new Funnel({ logger, diagnosticLog, dir: funnelDir })
const server = funnel.gatewayServer({ port: PORT, hostname: HOST })

await server.start()
