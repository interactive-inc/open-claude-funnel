import { HTTPException } from "hono/http-exception"
import { factory } from "@/factory"
import { Funnel } from "@/funnel"
import { FunnelSettingsStore } from "@/modules/settings/funnel-settings-store"
import { channelsRoutes } from "@/routes/channels/routes"
import { claudeRoutes } from "@/routes/claude/routes"
import { connectorsRoutes } from "@/routes/connectors/routes"
import { gatewayRoutes } from "@/routes/gateway/routes"
import { profilesRoutes } from "@/routes/profiles/routes"
import { reposRoutes } from "@/routes/repos/routes"
import { statusRoutes } from "@/routes/status/routes"
import { updateRoutes } from "@/routes/update/routes"

const base = factory.createApp()

base.use((c, next) => {
  c.set("funnel", new Funnel({ store: new FunnelSettingsStore() }))

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
  .route("/connectors", connectorsRoutes)
  .route("/channels", channelsRoutes)
  .route("/repos", reposRoutes)
  .route("/profiles", profilesRoutes)
  .route("/gateway", gatewayRoutes)
  .route("/status", statusRoutes)
  .route("/update", updateRoutes)
