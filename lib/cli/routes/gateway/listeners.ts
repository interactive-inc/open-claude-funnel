import { z } from "zod";
import { factory } from "@/cli/factory";
import { zValidator } from "@/cli/router/validator";
import { help } from "@/cli/routes/gateway/listeners.help";

export const gatewayListenersHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  async (c) => {
    const funnel = c.var.funnel;
    const result = await funnel.listeners.list();

    if (result.state === "offline") {
      return c.text("funnel gateway: not running", 503);
    }

    if (result.state === "error") {
      return c.text(`funnel gateway: ${result.reason}`, 503);
    }

    if (result.listeners.length === 0) {
      return c.text("funnel gateway: no running listeners");
    }

    const lines = result.listeners.map((entry) => {
      const health = entry.alive ? "alive" : "dead";

      return `  [${health.padEnd(5)}] ${entry.type.padEnd(8)} ${entry.name}`;
    });

    return c.text(`funnel gateway: running listeners\n${lines.join("\n")}`);
  },
);
