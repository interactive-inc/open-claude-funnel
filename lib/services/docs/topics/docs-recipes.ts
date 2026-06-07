export const docsRecipes = `funnel docs recipes — common task playbooks

— bootstrap a new repo —

  cd my-repo
  fnl channels add ops
  fnl channels ops connectors add slack-main --type=slack --bot-token-env=SLACK_BOT_TOKEN
  fnl claude                         # auto-installs .mcp.json, launches Claude

— add a second Slack workspace to one channel —

  fnl channels ops connectors add slack-eu --type=slack --bot-token-env=SLACK_EU_TOKEN

  Both connectors push events into the same channel; subscribers see all.

— two profiles sharing one channel —

  fnl channels add support
  fnl profiles add triage   --channel=support --options=--agent,triage
  fnl profiles add resolve  --channel=support --options=--agent,resolver
  fnl claude --profile triage    # in one terminal
  fnl claude --profile resolve   # in another

  Pick channel delivery=exclusive so each event goes to exactly one of them.

— schedule a daily cron prompt —

  fnl channels add daily
  fnl channels daily connectors add cron --type=schedule
  fnl channels daily connectors cron schedules add morning \\
    --cron="0 9 * * *" --prompt="summarize yesterday's PRs"

— diagnose "events stopped arriving" —

  fnl debug --all --json
  # read diagnosis.rootCause and diagnosis.nextActions[] from the result

— replay a real event to test a code change —

  fnl debug events --channel ops --limit 5
  fnl debug replay --channel ops --seq <pick from above>

— recover from a stuck gateway —

  fnl gateway logs               # confirm symptoms first
  fnl gateway restart
  fnl debug --all --json         # verify everything came back up

related: fnl docs debugging, fnl docs channels, fnl docs profiles`
