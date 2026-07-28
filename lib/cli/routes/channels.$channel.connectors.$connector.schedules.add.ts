import { factory } from "@/cli/factory"

const help = `funnel channels <ch> connectors <conn> schedules add <id> — add a schedule entry

usage: funnel channels <ch> connectors <conn> schedules add <id> (--cron="*/5 * * * *" | --run-at="2026-08-01T09:00:00+09:00") --prompt="..." [--enabled|--enabled=false] [--catchup-policy=latest|all|skip]

options:
  --cron <expr> / 5-field cron expression (exclusive with --run-at)
  --run-at <ISO datetime> / fire once at or after this instant (exclusive with --cron)
  --prompt <text> / prompt delivered on each fire (required)
  --enabled / fire on schedule (default: true; --enabled=false stores it disabled)
  --catchup-policy latest|all|skip / how missed fires are replayed after downtime (default: latest)`

export const channelsConnectorSchedulesAddHelpHandler = factory.createHandlers((c) => c.text(help))
