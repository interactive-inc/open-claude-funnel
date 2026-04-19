import { factory } from "@/factory"
import { statusHandler } from "@/routes/status/status"

export const statusRoutes = factory.createApp().get("/", ...statusHandler)
