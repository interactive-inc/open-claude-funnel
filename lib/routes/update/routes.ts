import { factory } from "@/factory"
import { updateHandler } from "@/routes/update/update"

export const updateRoutes = factory.createApp().get("/", ...updateHandler)
