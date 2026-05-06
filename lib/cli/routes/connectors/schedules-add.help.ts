export const help = `funnel connectors <name> schedules add — add a schedule entry

usage: funnel connectors <name> schedules add --cron "<expr>" --prompt "<text>" [--disabled] [--catchup <policy>]

options:
  --cron        5-field cron expression (min hour dom month dow)
  --prompt      prompt text delivered to subscribing channels when the cron fires
  --disabled    create the entry in disabled state
  --catchup     behavior when the daemon was down past matching minutes:
                  latest  — fire once with the most recent missed match (default)
                  all     — fire once per missed minute (capped at 24 h)
                  skip    — never fire missed matches

example:
  funnel connectors my-cron schedules add --cron "*/5 * * * *" --prompt "status check"`;
