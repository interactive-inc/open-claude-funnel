import { factory } from "@/factory"
import { requestDiscordHandler } from "@/routes/request/discord"
import { requestDiscordHelpHandler } from "@/routes/request/discord-help"
import { requestGroupHandler } from "@/routes/request/group"
import { requestSlackHandler } from "@/routes/request/slack"
import { requestSlackHelpHandler } from "@/routes/request/slack-help"

export const requestRoutes = factory
  .createApp()
  .get("/", ...requestGroupHandler)
  .get("/slack", ...requestSlackHelpHandler)
  .get("/slack/:method", ...requestSlackHandler)
  .get("/discord", ...requestDiscordHelpHandler)
  .get("/discord/:method", ...requestDiscordHandler)
