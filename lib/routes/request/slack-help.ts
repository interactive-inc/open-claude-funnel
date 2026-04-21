import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/request/slack.help"

export const requestSlackHelpHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => c.text(help),
)
