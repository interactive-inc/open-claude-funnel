import { factory } from "@/cli/factory";
import { requestDiscordHandler } from "@/cli/routes/request/discord";
import { requestDiscordHelpHandler } from "@/cli/routes/request/discord-help";
import { requestGroupHandler } from "@/cli/routes/request/group";
import { requestSlackHandler } from "@/cli/routes/request/slack";
import { requestSlackHelpHandler } from "@/cli/routes/request/slack-help";

export const requestRoutes = factory
  .createApp()
  .get("/", ...requestGroupHandler)
  .get("/slack", ...requestSlackHelpHandler)
  .get("/slack/:method", ...requestSlackHandler)
  .get("/discord", ...requestDiscordHelpHandler)
  .get("/discord/:method", ...requestDiscordHandler);
