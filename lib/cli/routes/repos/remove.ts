import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/repos/remove.help";

export const reposRemoveHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param");
    const funnel = c.var.funnel;

    funnel.repositories.remove(param.name);

    return c.text(`removed repo "${param.name}"`);
  },
);
