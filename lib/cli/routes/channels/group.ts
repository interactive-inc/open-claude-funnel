import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/channels/group.help"

export const channelsGroupHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => {
    const funnel = c.var.funnel
    const channels = funnel.channels.list()

    if (channels.length === 0) return c.text("no channels")

    const lines = channels.map((ch) => {
      const names = ch.connectors.map((c) => c.name)
      const connectors = names.length > 0 ? names.join(", ") : "(none)"

      return `${ch.name} [${connectors}]`
    })

    return c.text(lines.join("\n"))
  },
)
