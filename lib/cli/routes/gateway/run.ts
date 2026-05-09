import { resolve } from "node:path"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/gateway/run.help"

export const gatewayRunHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      "no-caffeine": z.string().optional(),
    }),
    help,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const gatewayScript = resolve(import.meta.dir, "../../../gateway/daemon.ts")
    const useCaffeinate = query["no-caffeine"] !== "true" && process.platform === "darwin"
    const command = useCaffeinate
      ? ["caffeinate", "-i", "bun", gatewayScript]
      : ["bun", gatewayScript]

    const exitCode = await funnel.process.attach(command)

    process.exit(exitCode)
  },
)
