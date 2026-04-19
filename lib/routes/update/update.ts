import { z } from "zod"
import { factory } from "@/factory"
import { NodeFunnelProcessRunner } from "@/modules/process/node-funnel-process-runner"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/update/update.help"

const PACKAGE = "@interactive-inc/claude-funnel"

export const updateHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  async (c) => {
    const runner = new NodeFunnelProcessRunner()
    const exitCode = await runner.attach(["bun", "i", "-g", PACKAGE])

    if (exitCode !== 0) {
      return c.text(`update failed (exit ${exitCode})`, 500)
    }

    return c.text(`updated ${PACKAGE}`)
  },
)
