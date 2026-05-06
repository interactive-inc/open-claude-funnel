import { factory } from "@/cli/factory";
import { statusHandler } from "@/cli/routes/status/status";

export const statusRoutes = factory.createApp().get("/", ...statusHandler);
