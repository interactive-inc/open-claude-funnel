import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/repos/show.help";

export const reposShowHandler = factory.createHandlers(
  zValidator("param", z.object({ name: z.string() })),
  zValidator("query", z.object({}), help),
  (c) => {
    const param = c.req.valid("param");
    const funnel = c.var.funnel;
    const repo = funnel.repositories.get(param.name);

    if (!repo) throw new HTTPException(404, { message: `repo "${param.name}" not found` });

    return c.text(`name: ${repo.name}\npath: ${repo.path}`);
  },
);
