import { Hono } from "hono"
import type { FunnelDiagnostics } from "@/services/diagnostics/funnel-diagnostics"
import type { FunnelDoctor } from "@/services/doctor/funnel-doctor"
import { requireBearerToken } from "@/gateway/auth-middleware"
import type { Env } from "@/gateway/factory"

type Deps = {
  diagnostics: FunnelDiagnostics
  doctor: FunnelDoctor
  /** Bearer token to gate every endpoint. Empty string disables auth (tests only). */
  token: string
}

/**
 * Mountable Hono app that exposes the service layer (`FunnelDiagnostics` +
 * `FunnelDoctor`) over loopback HTTP. The MCP server, which lives in a
 * different process, calls these endpoints to drive the autonomous
 * troubleshooting loop. The CLI bypasses HTTP and calls the same services
 * directly through the in-process funnel facade, so CLI and MCP share one
 * code path.
 */
export const buildServiceRoutes = (deps: Deps): Hono<Env> => {
  const app = new Hono<Env>()

  if (deps.token) {
    app.use("/diagnostics", requireBearerToken({ expected: deps.token }))
    app.use("/diagnostics/*", requireBearerToken({ expected: deps.token }))
    app.use("/doctor", requireBearerToken({ expected: deps.token }))
  }

  app.get("/diagnostics", async (c) => {
    const channel = c.req.query("channel")
    const all = c.req.query("all")

    if (all !== undefined) {
      const report = await deps.diagnostics.diagnoseAll()

      return c.json(report)
    }

    const report = await deps.diagnostics.diagnose(channel ?? undefined)

    if (!report) return c.json({ error: "channel not found" }, 404)

    return c.json(report)
  })

  app.get("/diagnostics/events", async (c) => {
    const channel = c.req.query("channel") ?? null
    const connector = c.req.query("connector")
    const limit = Number(c.req.query("limit") ?? "20")
    const events = await deps.diagnostics.recentEvents(channel, { connector, limit })

    return c.json(events)
  })

  app.get("/diagnostics/dropped", async (c) => {
    const channel = c.req.query("channel") ?? null
    const connector = c.req.query("connector")
    const limit = Number(c.req.query("limit") ?? "20")
    const events = await deps.diagnostics.droppedEvents(channel, { connector, limit })

    return c.json(events)
  })

  app.get("/diagnostics/errors", async (c) => {
    const channel = c.req.query("channel") ?? null
    const connector = c.req.query("connector")
    const limit = Number(c.req.query("limit") ?? "20")
    const errors = await deps.diagnostics.connectionErrors(channel, { connector, limit })

    return c.json(errors)
  })

  app.get("/diagnostics/raw", async (c) => {
    const channel = c.req.query("channel") ?? null
    const connector = c.req.query("connector")
    const limit = Number(c.req.query("limit") ?? "20")
    const events = await deps.diagnostics.rawEvents(channel, { connector, limit })

    return c.json(events)
  })

  app.get("/diagnostics/connection", async (c) => {
    const channel = c.req.query("channel") ?? null
    const connector = c.req.query("connector")
    const limit = Number(c.req.query("limit") ?? "20")
    const rows = await deps.diagnostics.connectionTimeline(channel, { connector, limit })

    return c.json(rows)
  })

  app.get("/diagnostics/logs", async (c) => {
    const grep = c.req.query("grep") ?? undefined
    const limit = Number(c.req.query("limit") ?? "200")
    const result = await deps.diagnostics.recentLogs({ grep, limit })

    return c.json(result)
  })

  app.post("/diagnostics/replay", async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const channel = typeof body.channel === "string" ? body.channel : null
    const seq = typeof body.seq === "number" ? body.seq : undefined

    if (!channel) return c.json({ error: "channel is required" }, 400)

    const result = await deps.diagnostics.replay(channel, seq)

    return c.json(result)
  })

  app.post("/doctor", async (c) => {
    const body = await c.req.json().catch(() => ({}) as Record<string, unknown>)
    const mode =
      body.mode === "safe" || body.mode === "aggressive" || body.mode === "off" ? body.mode : "off"
    const report = await deps.doctor.run(mode)

    return c.json(report)
  })

  return app
}
