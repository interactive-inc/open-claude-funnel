import { HTTPException } from "hono/http-exception"
import { factory } from "@/cli/factory"
import { channelsRoutes } from "@/cli/routes/channels/routes"
import { claudeRoutes } from "@/cli/routes/claude/routes"
import { gatewayRoutes } from "@/cli/routes/gateway/routes"
import { profilesRoutes } from "@/cli/routes/profiles/routes"
import { statusRoutes } from "@/cli/routes/status/routes"
import { updateRoutes } from "@/cli/routes/update/routes"
import { Funnel } from "@/funnel"

const base = factory.createApp()

base.use((c, next) => {
  c.set("funnel", new Funnel())

  return next()
})

base.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.text(`error: ${error.message}`, error.status)
  }

  return c.text(`error: ${error instanceof Error ? error.message : String(error)}`, 400)
})

export const app = base
  .route("/claude", claudeRoutes)
  .route("/channels", channelsRoutes)
  .route("/profiles", profilesRoutes)
  .route("/gateway", gatewayRoutes)
  .route("/status", statusRoutes)
  .route("/update", updateRoutes)
