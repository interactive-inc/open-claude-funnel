---
name: funnel
description: Use the funnel CLI / MCP to route external events (Slack / GitHub / Discord / cron) into Claude Code, and to send replies back through the same connectors via dedicated MCP tools. Covers the channels-with-nested-connectors data model, the launch flow (gateway daemon + MCP), and the reply path. Defer flag-level details to `funnel <subcommand> --help`.
user-invocable: false
disable-model-invocation: false
metadata:
  description: Operate the funnel hub — manage channels, connectors, profiles; launch Claude with a channel; reply via MCP tools.
  tags: [funnel, mcp, slack, discord, github]
---

## What funnel is

`funnel` (CLI: `funnel` or `fnl`) is a hub that:

1. **Subscribes** to external sources via per-type connectors (Slack Socket Mode, Discord Gateway, GitHub `gh` CLI poll, cron schedule).
2. **Routes** their events through user-defined channels — each channel holds its own set of connectors.
3. **Delivers** events to Claude Code over a stdio MCP, where they appear as `<channel source="funnel">` notifications carrying `meta.event_type` and the originating `channel` / `connector` names.
4. **Reflects** outbound calls back: the same MCP exposes one tool per configured connector (`discord`, `slack-prod`, `gh-main`, …) so Claude can reply, post, react, or call any adapter API directly without spawning a CLI.

The hub stores its config under `~/.funnel/`. The runtime gateway daemon listens on port 9742 (override via `FUNNEL_PORT`).

## Mental model

```
Channel (subscription box, name = e.g. "ops")
  └── Connectors (each one type-tagged)
         ├── slack    — Socket Mode listener + Web API adapter
         ├── discord  — Gateway listener + REST adapter
         ├── gh       — gh CLI poll + gh CLI adapter
         └── schedule — cron entries (one-way: timer → channel; no adapter)

Profile (named launch preset)
  = { name, path (cwd), subAgent, channelId }

Settings = { channels[], profiles[] } at ~/.funnel/settings.json
Connectors persisted per type at ~/.funnel/connectors/<type>/<name>.(json|jsonl)
```

`channelId` is a uuid; the CLI resolves channel **names** to ids before calling the engine.

## Common operations

Always defer to `funnel <subcommand> --help` for exact flags. The shapes below are correct as of 0.8.

### Set up a channel and a connector

```bash
fnl channels add ops
fnl channels ops connectors add my-discord --type=discord --bot-token=<token>
fnl channels ops connectors add my-slack   --type=slack   --bot-token=xoxb-... --app-token=xapp-...
fnl channels ops connectors add my-gh      --type=gh      [--poll-interval=60]
fnl channels ops connectors add timer      --type=schedule
fnl channels ops connectors timer schedules add morning --cron="0 9 * * *" --prompt="standup"
```

### Launch Claude bound to a channel

```bash
fnl claude --channel ops                    # raw launch (cwd = current)
fnl profiles add cto --path=/repo/myapp --sub-agent=cto --channel=ops
fnl claude --profile cto                    # named profile launch
fnl profiles cto                            # alias for `claude --profile cto`
```

`fnl claude` auto-starts the gateway daemon, installs the funnel MCP into the target repo's `.mcp.json`, injects `FUNNEL_CHANNEL_ID`, and execs Claude.

### Inspect / operate the daemon

```bash
fnl status            # channels / profiles / gateway / connected MCP clients
fnl gateway           # short status (alias for `gateway status`)
fnl gateway listeners # alive / dead per connector
fnl gateway logs -n 100  # tails /tmp/funnel/funnel.log as YAML
fnl gateway restart
```

### Verbs and HTTP method

Every CLI verb (`add` / `set` / `remove` / `rename` / `as-default` / `request`) is rewritten to `POST` and stays in the URL as a literal segment. Read paths (no verb) stay `GET`. There is no PUT / DELETE — Hono disambiguates by URL segment, not method semantics.

CLI flags use kebab-case (`--bot-token`, `--poll-interval`, `--sub-agent`, `--catchup-policy`); the schemas validate with the same kebab keys before mapping to camelCase internally.

## Reply path: MCP tools

When Claude is launched via funnel, the MCP server reads the channel's connectors and exposes one tool per callable connector (`schedule` is one-way and skipped). Tool name = connector name. Schema:

```jsonc
{
  "name": "discord",
  "inputSchema": {
    "type": "object",
    "properties": {
      "method": { "type": "string" },   // e.g. "POST" or "chat.postMessage"
      "path":   { "type": "string" },   // e.g. "/channels/<id>/messages" or "chat.postMessage"
      "body":   { "type": "object" }    // adapter-specific
    },
    "required": ["method", "path"]
  }
}
```

Examples:

- Discord reply: `name="discord"` `{method:"POST", path:"/channels/<channel_id>/messages", body:{content:"hi", message_reference:{message_id:"<msg>"}}}`
- Discord reaction: `{method:"PUT", path:"/channels/<c>/messages/<m>/reactions/<emoji>/@me", body:{}}`
- Slack post: `name="my-slack"` `{method:"POST", path:"chat.postMessage", body:{channel:"D...",text:"hi"}}`
- Slack thread: same with `thread_ts:"<ts>"` in body
- GitHub comment: `name="my-gh"` `{method:"POST", path:"repos/owner/repo/issues/N/comments", body:{body:"..."}}`

The MCP forwards over HTTP to `POST /channels/<channel>/connectors/<connector>/call`, so latency is essentially that of the upstream API. **Prefer these MCP tools over running `fnl ... request` via Bash** — the bash form spawns a fresh CLI process per call and is significantly slower.

## Diagnostics checklist

When events from a connector aren't reaching Claude, work through:

1. `fnl gateway listeners` — is the listener `alive` for the connector?
2. `tail -f /tmp/funnel/funnel.log`
   - `discord ready` — bot logged in (id / tag / guild count).
   - `discord messageCreate` — receive event arrived; `mentioned: "true"` confirms the bot id is in `mentions`.
   - `discord skip` — only fires when author is a bot (skipped intentionally).
3. Slack: `slack listener started` plus its own auth.test result. Check the bot has `app_mentions:read` etc.
4. GitHub: `gh poll failed` with `stderr: auth` means `gh auth status` is unhealthy.
5. Discord intent — `Message Content Intent` must be enabled in the developer portal, otherwise `messageCreate` fires without content.

For the reply side: if Claude's `tools/list` doesn't show your connector, restart Claude — the MCP enumerates connectors at startup time.

## Where to dig in the codebase

- CLI routes: `lib/cli/routes/` (flat, dotted file names matching URL paths; `$param` segments).
- Verb mapping: `lib/cli/router/to-request.ts`.
- Engine domain: `lib/engine/{channels,profiles,claude,mcp,settings,fs,process,logger,time,id}/`.
- Connectors: `lib/connectors/` (one Store + Listener + Adapter per type).
- Gateway daemon: `lib/gateway/{daemon,gateway,gateway-server,broadcaster,listener-supervisor}.ts`.
- Daemon HTTP routes: `lib/gateway/routes/` (including `channels.connectors.call.ts` for the MCP reply path).
- MCP stdio server: `lib/engine/mcp/channel-server.ts`.

When changing CLI surface, keep the file-name = URL-path = `$param` rule, and remember that one URL = one file = one method (since every verb maps to POST, multi-method-per-file does not happen).

## Don'ts

- Don't tell users to `fnl connectors ...` at the top level — connectors only exist nested under a channel.
- Don't use `attach` / `detach` — those verbs were removed; it's `add` / `remove`.
- Don't construct bash commands when an MCP tool covers the same call.
- Don't rely on `--method` doubling as both HTTP verb and Slack API method (legacy CLI behavior). For MCP tools, `method` and `path` are separate fields matching the adapter's `CallInput`.
