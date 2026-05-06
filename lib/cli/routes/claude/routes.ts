import { factory } from "@/cli/factory";
import { claudeHandler } from "@/cli/routes/claude/claude";

export const claudeRoutes = factory.createApp().get("/", ...claudeHandler);
