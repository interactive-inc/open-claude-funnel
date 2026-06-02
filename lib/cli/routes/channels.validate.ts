import { factory } from "@/cli/factory"

const help = `funnel channels <channel> validate — check connector configuration

usage: funnel channels <channel> validate [--json]

options:
  --json   output as JSON

Checks that each connector has the required tokens and fields set.
Does not make any network calls — static config check only.

examples:
  funnel channels open-karte validate
  funnel channels open-karte validate --json`

export const channelsValidateHelpHandler = factory.createHandlers((c) => c.text(help))
