import { factory } from "@/cli/factory"

const help = `funnel channels <ch> connectors <conn> schedules add <id> — add a schedule entry

usage: funnel channels <ch> connectors <conn> schedules add <id> --cron="*/5 * * * *" --prompt="..." [--enabled=true] [--catchup-policy=latest|all|skip]`

export const channelsConnectorSchedulesAddHelpHandler = factory.createHandlers((c) => c.text(help))
