export const docsConnectors = `funnel docs connectors — external service bindings

A connector is one connection to one external service. It is nested inside a
channel — a channel can host several connectors of different types.

types:

  slack      Socket Mode listener + REST adapter
  gh         GitHub polling listener + REST adapter
  discord    Discord listener + REST adapter
  schedule   cron + one-shot tick listener (no adapter — schedule does not send out)

per-type parts:

  Listener   external → Funnel inbound. push (Slack), pull (GitHub), or tick
             (Schedule cron).
  Adapter    Claude → external outbound. only on callable types.
  Schema     config validation.
  EventProcessor  shapes raw events into the channel payload.

operations (all nested under a channel):

  fnl channels <ch> connectors                       list
  fnl channels <ch> connectors <name>                show
  fnl channels <ch> connectors add <name> --type=…   create
  fnl channels <ch> connectors set <name> …          update
  fnl channels <ch> connectors remove <name>         delete
  fnl channels <ch> connectors rename <old> <new>    rename
  fnl channels <ch> connectors <name> request …      proxy an HTTP call to the
                                                     adapter (e.g. send a Slack
                                                     message via Claude path)
  fnl channels <ch> connectors <name> schedules …    manage cron / one-shot
                                                     schedule entries

tokens:

  funnel.json must NOT contain tokens. Set them via:

    fnl channels <ch> connectors set <name> --bot-token-env=SLACK_BOT_TOKEN

  …or leave unset and fnl claude will TTY-prompt at first launch and persist
  to ~/.funnel/projects/<id>/settings.json.

related: fnl docs channels, fnl docs debugging`
