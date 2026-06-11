import { join } from "node:path"
import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { gatewayLoopbackUrl } from "@/engine/http/gateway-base-url"
import { funnelTmpDir } from "@/engine/settings/tmp-dir"

const startHelp = `funnel gateway start — start the gateway in background

usage: funnel gateway start [--no-caffeine]

Spawned as a detached background process so it keeps running after the terminal is closed.
On macOS wraps the process with caffeinate -is by default to prevent idle and system sleep.
Use --no-caffeine to disable caffeinate.

port: 9743 (CLI default; override via FUNNEL_PORT)
pid:  ~/.funnel/gateway.pid
log:  ${join(funnelTmpDir(), "gateway.log")}

examples:
  funnel gateway start
  funnel gateway start --no-caffeine

programmable: funnel.gateway.start({ caffeinate })`

const HEALTH_TIMEOUT_MS = 5000
const HEALTH_POLL_INTERVAL_MS = 100

// The PID appearing only proves the daemon spawned; commands issued right
// after `gateway start` need the HTTP surface to be accepting. Poll /health
// so "started" means "ready", not "forked".
const waitForHealth = async (port: number): Promise<boolean> => {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS

  while (Date.now() < deadline) {
    const res = await fetch(`${gatewayLoopbackUrl(port)}/health`).catch(() => null)

    if (res?.ok) return true

    await new Promise((resolve) => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS))
  }

  return false
}

export const gatewayStartHandler = factory.createHandlers(
  helpGuard(startHelp),
  zValidator(
    "query",
    z.object({
      "no-caffeine": z.string().optional(),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel

    if (funnel.gateway.isRunning()) {
      const status = funnel.gateway.getStatus()

      return c.text(`funnel gateway: already running (pid ${status.pid})`)
    }

    const started = await funnel.gateway.start({
      caffeinate: query["no-caffeine"] !== "true",
    })

    if (!started) {
      throw new HTTPException(500, {
        message: "funnel gateway: failed to start — inspect the daemon log with `fnl gateway logs`",
      })
    }

    const status = funnel.gateway.getStatus()
    const healthy = await waitForHealth(status.port)

    if (!healthy) {
      return c.text(
        `funnel gateway: started (pid ${status.pid}, port ${status.port}) but /health did not respond within ${HEALTH_TIMEOUT_MS / 1000}s — check \`fnl gateway logs\``,
      )
    }

    return c.text(`funnel gateway: started (pid ${status.pid}, port ${status.port})`)
  },
)
