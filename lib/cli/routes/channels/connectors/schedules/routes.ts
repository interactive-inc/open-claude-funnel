import { factory } from "@/cli/factory"
import { channelsConnectorsSchedulesAddHandler } from "@/cli/routes/channels/connectors/schedules/add"
import { channelsConnectorsSchedulesGroupHandler } from "@/cli/routes/channels/connectors/schedules/group"
import { channelsConnectorsSchedulesRemoveHandler } from "@/cli/routes/channels/connectors/schedules/remove"

export const channelsConnectorsSchedulesRoutes = factory
  .createApp()
  .get("/", ...channelsConnectorsSchedulesGroupHandler)
  .post("/:id", ...channelsConnectorsSchedulesAddHandler)
  .delete("/:id", ...channelsConnectorsSchedulesRemoveHandler)
