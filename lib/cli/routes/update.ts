import { HTTPException } from "hono/http-exception"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { NodeFunnelProcessRunner } from "@/engine/process/node-process-runner"

const updateHelp = `funnel update — update funnel to the latest version

usage: funnel update

Runs "bun i -g @interactive-inc/claude-funnel".

This command has no programmable equivalent — package management belongs to
the host (npm / bun / yarn install in the host's own way).`

const PACKAGE = "@interactive-inc/claude-funnel"

export const updateHandler = factory.createHandlers(helpGuard(updateHelp), async (c) => {
  const runner = new NodeFunnelProcessRunner()
  const exitCode = await runner.attach(["bun", "i", "-g", PACKAGE])

  if (exitCode !== 0) {
    throw new HTTPException(500, { message: `update failed (exit ${exitCode})` })
  }

  return c.text(`updated ${PACKAGE}`)
})
