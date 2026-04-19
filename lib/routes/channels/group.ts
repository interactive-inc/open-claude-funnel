import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/channels/group.help"

export const channelsGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => {
    const funnel = c.var.funnel
    const channels = funnel.channels.list()

    if (channels.length === 0) return c.text("no channels")

    const lines = channels.map((ch) => {
      const connectors = ch.connectors.length > 0 ? ch.connectors.join(", ") : "(none)"

      return `${ch.name} [${connectors}]`
    })

    return c.text(lines.join("\n"))
  },
)
