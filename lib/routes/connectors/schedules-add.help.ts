export const help = `funnel connectors <name> schedules add — add a schedule entry

usage: funnel connectors <name> schedules add --cron "<expr>" --prompt "<text>" [--disabled]

options:
  --cron        5-field cron expression (min hour dom month dow)
  --prompt      prompt text delivered to subscribing channels when the cron fires
  --disabled    create the entry in disabled state

example:
  funnel connectors my-cron schedules add --cron "*/5 * * * *" --prompt "status check"`
