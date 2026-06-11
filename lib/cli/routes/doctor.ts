import { z } from "zod"
import { factory } from "@/cli/factory"
import { booleanFlag } from "@/cli/router/boolean-flag"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/engine/yaml/yaml-render"

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
      fix: booleanFlag,
      aggressive: booleanFlag,
    }),
  ),
  async (c) => {
    const query = c.req.valid("query")
    const wantsFix = query.fix === true
    const wantsAggressive = query.aggressive === true
    const mode = wantsFix ? (wantsAggressive ? "aggressive" : "safe") : "off"

    const report = await c.env.funnel.doctor.run(mode)

    return c.text(renderYaml(report))
  },
)
