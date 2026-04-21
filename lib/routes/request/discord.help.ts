export const help = `funnel request discord — call the Discord REST API via a connector

usage: funnel request discord <method> <path> [<json-body>] --connector <name>

<method> is the HTTP verb (post / put / delete / patch / get).
<path> is the Discord API path relative to https://discord.com/api/v10 (without leading /).
<name> must match the connector's name (typically meta.connector on an inbound event).

Reply only when meta.mentioned="true" unless instructed otherwise.

examples (reply):
  funnel request discord post channels/<meta.channel_id>/messages \\
    '{"content":"...","message_reference":{"message_id":"<id>"}}' \\
    --connector <meta.connector>

examples (react / delete / edit):
  funnel request discord put    channels/<cid>/messages/<mid>/reactions/<emoji>/@me --connector <name>
  funnel request discord delete channels/<cid>/messages/<mid>                        --connector <name>
  funnel request discord patch  channels/<cid>/messages/<mid> '{"content":"edit"}'   --connector <name>`
