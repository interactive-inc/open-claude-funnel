import { z } from "zod"
import { factory } from "@/cli/factory"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { zValidator } from "@/cli/router/validator"
import { help } from "@/cli/routes/update/update.help"

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
