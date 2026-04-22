export const help = `funnel connectors add — add a connector

usage:
  funnel connectors add <name> --type slack    --bot-token xoxb-... --app-token xapp-...
  funnel connectors add <name> --type gh       [--poll-interval <seconds>]
  funnel connectors add <name> --type discord  --bot-token <discord-bot-token>
  funnel connectors add <name> --type schedule

slack (Socket Mode):
  --bot-token             Slack Bot Token (starts with xoxb-)
  --app-token             Slack App Token (starts with xapp-)

gh (GitHub, gh CLI):
  --poll-interval         polling interval for /notifications (seconds, default 60)
  note: uses the gh CLI (must be authenticated via gh auth login); no token required

discord (Discord Gateway):
  --bot-token             Discord Bot Token

schedule (cron-driven prompts):
  no extra flags at connector level — add entries with:
    funnel connectors <name> schedules add --cron "* * * * *" --prompt "..."

examples:
  funnel connectors add prod-slack --type slack --bot-token xoxb-... --app-token xapp-...
  funnel connectors add my-gh --type gh --poll-interval 30
  funnel connectors add my-discord --type discord --bot-token MTI...
  funnel connectors add my-cron --type schedule`
