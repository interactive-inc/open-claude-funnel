import { z } from "zod"
import { factory } from "@/cli/factory"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/cli/yaml-render"

const doctorHelp = `funnel doctor / diagnose every channel; --fix applies safe self-healing

usage / funnel doctor [--fix] [--aggressive]

modes:
  (default) / read-only diagnosis, safe to run anytime
  --fix / start the gateway if down, restart dead listeners (idempotent)
  --fix --aggressive / also restart the gateway when safe fixes do not return things to ok

output / valid YAML, parseable by yq

programmable / await funnel.doctor.run() / await funnel.doctor.run("safe") / await funnel.doctor.run("aggressive")

examples:
  funnel doctor
  funnel doctor --fix
  funnel doctor --fix --aggressive`

export const doctorHandler = factory.createHandlers(
  helpGuard(doctorHelp),
  zValidator(
    "query",
    z.object({
      fix: z.enum(["true", "false", ""]).optional(),
      aggressive: z.enum(["true", "false", ""]).optional(),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query")
    const wantsFix = query.fix === "true" || query.fix === ""
    const wantsAggressive = query.aggressive === "true" || query.aggressive === ""
    const mode = wantsFix ? (wantsAggressive ? "aggressive" : "safe") : "off"

    const report = await c.env.funnel.doctor.run(mode)

    return c.text(renderYaml(report))
  },
)
