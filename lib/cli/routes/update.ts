import { HTTPException } from "hono/http-exception"
import { z } from "zod"
import { factory } from "@/cli/factory"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"
import { zValidator } from "@/cli/router/validator"

export const updateHelp = `funnel update — update funnel to the latest version

usage: funnel update

Runs "bun i -g @interactive-inc/claude-funnel".`

const PACKAGE = "@interactive-inc/claude-funnel"

export const updateHandler = factory.createHandlers(
  zValidator("query", z.object({}), updateHelp),
  async (c) => {
    const runner = new NodeFunnelProcessRunner()
    const exitCode = await runner.attach(["bun", "i", "-g", PACKAGE])

    if (exitCode !== 0) {
      throw new HTTPException(500, { message: `update failed (exit ${exitCode})` })
    }

    return c.text(`updated ${PACKAGE}`)
  },
)
