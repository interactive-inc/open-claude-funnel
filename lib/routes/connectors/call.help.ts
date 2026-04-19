export const help = `funnel connectors <name> <method> <path> [body] — call a connector API

usage:
  funnel connectors <name> <method> <path> [<json-body>]

<method>:
  get / post / put / patch / delete / head / options

Slack examples (every API is posted via POST internally):
  funnel connectors my-slack post chat.postMessage '{"channel":"D...","text":"hi"}'
  funnel connectors my-slack post chat.update      '{"channel":"D...","ts":"...","text":"edit"}'
  funnel connectors my-slack post chat.delete      '{"channel":"D...","ts":"..."}'
  funnel connectors my-slack post users.info       '{"user":"U..."}'

Discord examples (per HTTP method):
  funnel connectors my-discord post   channels/C/messages   '{"content":"hi"}'
  funnel connectors my-discord delete channels/C/messages/M`
