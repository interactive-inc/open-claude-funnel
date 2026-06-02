import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { channelDeliveryModeSchema } from "@/engine/settings/settings-schema"

const setDeliveryHelp = `funnel channels <name> set delivery <mode> — change a channel's routing mode

usage: funnel channels <name> set delivery fanout | exclusive

modes:
  fanout      every connected WS client receives every event (default)
  exclusive   each event is delivered to exactly one connected client (round-robin)

tap=all clients (TUI dashboard, debugging) always receive regardless of mode.
`

export const channelsSetDeliveryHandler = factory.createHandlers(
  zValidator(
    "param",
    z.object({
      channel: z.string(),
      mode: channelDeliveryModeSchema,
    }),
    setDeliveryHelp,
  ),
  (c) => {
    const param = c.req.valid("param")
    const funnel = c.env.funnel

    funnel.channels.setDelivery(param.channel, param.mode)

    return c.text(`channel "${param.channel}" delivery set to ${param.mode}`)
  },
)
