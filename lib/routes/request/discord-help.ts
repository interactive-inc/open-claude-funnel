import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/request/discord.help"

export const requestDiscordHelpHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => c.text(help),
)
