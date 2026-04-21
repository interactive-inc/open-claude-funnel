export const help = `funnel request slack — call the Slack Web API via a connector

usage: funnel request slack post <path> [<json-body>] --connector <name>

Slack always uses POST. <path> is the Web API method name (e.g. chat.postMessage).
<name> must match the connector's name (typically meta.connector on an inbound event).

Reply only when meta.mentioned="true" unless instructed otherwise.

examples (reply):
  funnel request slack post chat.postMessage \\
    '{"channel":"<meta.channel_id>","text":"...","thread_ts":"<meta.thread_ts>"}' \\
    --connector <meta.connector>

examples (edit / delete / react / lookup):
  funnel request slack post chat.update       '{"channel":"...","ts":"...","text":"edit"}' --connector <name>
  funnel request slack post chat.delete       '{"channel":"...","ts":"..."}' --connector <name>
  funnel request slack post reactions.add     '{"channel":"...","timestamp":"...","name":"eyes"}' --connector <name>
  funnel request slack post users.info        '{"user":"U..."}' --connector <name>`
