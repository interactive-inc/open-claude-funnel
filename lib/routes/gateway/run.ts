import { resolve } from "node:path"
import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/gateway/run.help"

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
    const gatewayScript = resolve(import.meta.dir, "../../modules/gateway/daemon.ts")

    const useCaffeinate = query["no-caffeine"] !== "true" && process.platform === "darwin"
    const command = useCaffeinate
      ? ["caffeinate", "-i", "bun", gatewayScript]
      : ["bun", gatewayScript]

    const proc = Bun.spawn(command, {
      stdio: ["inherit", "inherit", "inherit"],
    })

    process.on("SIGINT", () => proc.kill("SIGINT"))
    process.on("SIGTERM", () => proc.kill("SIGTERM"))

    const exitCode = await proc.exited

    process.exit(exitCode)
  },
)
