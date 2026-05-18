import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"
import { resolveDaemonScript } from "@/gateway/resolve-daemon-script"

export const runHelp = `funnel gateway run — run the gateway in foreground

usage: funnel gateway run [--no-caffeine]

For developers. The process is tied to the current terminal and exits on SIGINT / SIGTERM.
On macOS wraps with caffeinate -is by default. Use --no-caffeine to disable.

For normal usage prefer funnel gateway start.

examples:
  funnel gateway run
  funnel gateway run --no-caffeine`

export const gatewayRunHandler = factory.createHandlers(
  zValidator(
    "query",
    z.object({
      "no-caffeine": z.string().optional(),
    }),
    runHelp,
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.var.funnel

    const gatewayScript = resolveDaemonScript()
    const useCaffeinate = query["no-caffeine"] !== "true" && process.platform === "darwin"
    const command = useCaffeinate
      ? ["caffeinate", "-is", "bun", gatewayScript]
      : ["bun", gatewayScript]

    const exitCode = await funnel.process.attach(command)

    process.exit(exitCode)
  },
)
