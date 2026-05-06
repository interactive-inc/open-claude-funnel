import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/request/discord.help";

export const requestDiscordHelpHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => c.text(help),
);
