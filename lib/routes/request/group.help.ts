export const help = `funnel request — send an outbound API call via a connector

usage: funnel request <platform> <method> <path> [<json-body>] --connector <name>

platforms:
  slack
  discord

examples:
  funnel request slack   post chat.postMessage '{"channel":"...","text":"..."}' --connector my-slack
  funnel request discord post channels/<cid>/messages '{"content":"..."}' --connector my-discord

more:
  funnel request slack   --help
  funnel request discord --help`
