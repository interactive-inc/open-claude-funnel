import { factory } from "@/cli/factory"

const help = `funnel channels <ch> connectors <conn> schedules add <id> — add a schedule entry

usage: funnel channels <ch> connectors <conn> schedules add <id> --cron="*/5 * * * *" --prompt="..." [--enabled|--enabled=false] [--catchup-policy=latest|all|skip]

options:
  --cron <expr> / 5-field cron expression (required)
  --prompt <text> / prompt delivered on each fire (required)
  --enabled / fire on schedule (default: true; --enabled=false stores it disabled)
  --catchup-policy latest|all|skip / how missed fires are replayed after downtime (default: latest)`

export const channelsConnectorSchedulesAddHelpHandler = factory.createHandlers((c) => c.text(help))
