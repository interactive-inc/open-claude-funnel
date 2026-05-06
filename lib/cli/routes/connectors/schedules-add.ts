import { z } from "zod";
import { factory } from "@/cli/factory";
import { matchCron } from "@/connectors/match-cron";
import { scheduleCatchupPolicySchema } from "@/connectors/schedule-connector-schema";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/connectors/schedules-add.help";

export const connectorsSchedulesAddHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator(
    "query",
    z.object({
      cron: z.string(),
      prompt: z.string(),
      disabled: z.string().optional(),
      catchup: scheduleCatchupPolicySchema.optional(),
    }),
    help,
  ),
  (c) => {
    const param = c.req.valid("param");
    const query = c.req.valid("query");
    const funnel = c.var.funnel;

    matchCron(query.cron, new Date());

    const entry = funnel.schedule.addEntry(param.name, {
      cron: query.cron,
      prompt: query.prompt,
      enabled: query.disabled !== "true",
      catchupPolicy: query.catchup ?? "latest",
    });

    return c.text(`added schedule entry "${entry.id}" to connector "${param.name}"`);
  },
);
