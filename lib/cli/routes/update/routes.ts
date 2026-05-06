import { factory } from "@/cli/factory";
import { updateHandler } from "@/cli/routes/update/update";

export const updateRoutes = factory.createApp().get("/", ...updateHandler);
