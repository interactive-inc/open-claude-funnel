import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/request/slack.help";

export const requestSlackHelpHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  (c) => c.text(help),
);
