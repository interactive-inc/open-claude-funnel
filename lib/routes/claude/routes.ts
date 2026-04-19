import { factory } from "@/factory"
import { claudeHandler } from "@/routes/claude/claude"

export const claudeRoutes = factory.createApp().get("/", ...claudeHandler)
