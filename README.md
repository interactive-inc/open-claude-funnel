# @interactive-inc/claude-funnel

[![npm](https://img.shields.io/npm/v/@interactive-inc/claude-funnel.svg)](https://www.npmjs.com/package/@interactive-inc/claude-funnel)
[![license](https://img.shields.io/npm/l/@interactive-inc/claude-funnel.svg)](./LICENSE)

A hub CLI that connects multiple Claude Code agents to external services (Slack / GitHub / Discord). External events flow through subscription "channels" into Claude Code sessions, and outbound API calls from Claude are funneled through the same connectors.

The command is `funnel` or its shorthand `fnl`.

## Overview

```
Slack/others         Connectors      Channels                Claude Code
(external APIs) ─→   (funnel)  ─→    (subscription router) ──WS/MCP─→   (received as <channel> tags)
                                                           ↑
                                               funnel MCP server (funnel mcp)
```

## Requirements

- [Bun](https://bun.sh) 1.3 or later (runtime)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI
- A Slack / GitHub / Discord token or CLI, depending on which connectors you use

## Install

```bash
bun add -g @interactive-inc/claude-funnel
```

After install, `funnel` and `fnl` are available globally.

## Quick start

```bash
# Register an external connection (Connector)
fnl connectors add my-slack --type slack --bot-token xoxb-... --app-token xapp-...

# Create a subscription box (Channel) and attach the connector
fnl channels add my-inbox
fnl channels my-inbox connectors attach my-slack

# Start the gateway (connects to Slack Socket Mode)
fnl gateway start

# Launch Claude (funnel is auto-registered in the current directory's .mcp.json)
fnl claude --channel my-inbox
```

## Commands

```
fnl connectors                              list
fnl connectors add <name> --type <t> --bot-token <t> --app-token <t>
fnl connectors <name>                       show details
fnl connectors <name> set [--bot-token ...] [--app-token ...]
fnl connectors rename <old> <new>
fnl connectors remove <name>
fnl connectors <name> <method> <path> [body]   call API (get/post/put/delete/...)

fnl channels                                list
fnl channels add <name>
fnl channels <name>                         show details
fnl channels <name> connectors attach <connector>
fnl channels <name> connectors detach <connector>
fnl channels rename <old> <new>
fnl channels remove <name>

fnl profiles                                list launch profiles
fnl profiles add <name> --channel <c> [--repo <r>] [--sub-agent <s>] [--env-file <f>]
fnl profiles <name> run                     launch (sugar for fnl claude)
fnl profiles <name>                         launch (alias for run)
fnl profiles <name> set [--channel ...] [--repo ...] [--sub-agent ...] [--env-file ...]
fnl profiles rename <old> <new>
fnl profiles remove <name>

fnl repos                                   list repositories (extra)
fnl repos add <name> [--path <path>]        register funnel MCP (path defaults to cwd)
fnl repos <name>                            show details
fnl repos <name> set [--path <path>]
fnl repos rename <old> <new>
fnl repos remove <name>

fnl claude                                  launch the "default" profile
fnl claude --profile <name>                 launch a named profile
fnl claude --channel <c> [--repo <r>] [--sub-agent <s>] [--env-file <f>]
                                            raw launch (no profile)
fnl mcp                                     run as an MCP server (invoked from .mcp.json)

fnl gateway                                 running status
fnl gateway start / stop / restart / run / logs
fnl update                                  update funnel via bun i -g
fnl status                                  overall status (connectors / channels / profiles / repos / gateway)

fnl --version
fnl --help        (every subcommand has --help)
```

## Data model

```
Connector =
  | { type: "slack",   name, botToken, appToken }          Slack Socket Mode
  | { type: "gh",      name, pollInterval? }                GitHub (gh CLI)
  | { type: "discord", name, botToken }                     Discord Gateway

Channel    = { name, connectors[] }                        subscription box
Repository = { name, path }                                 extra
Profile    = { name, channel, repo?, subAgent?, envFiles? } launch profile

Settings = { connectors[], channels[], repositories[], profiles[] }
         → ~/.funnel/settings.json
```

## Discord bot setup

- Create a bot in the Discord Developer Portal and obtain its token
- Enable `Message Content Intent` under Privileged Gateway Intents
- Invite the bot via OAuth2 → URL Generator with the `bot` scope and `View Channels` / `Send Messages` / `Read Message History` permissions

## Environment variables

| Variable             | Purpose                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------- |
| `FUNNEL_CHANNEL_ID`  | Injected into the child process by `fnl claude`; funnel MCP uses it to subscribe.       |
| `FUNNEL_PORT`        | Gateway port (default 9742).                                                            |
| `FUNNEL_GATEWAY_URL` | Gateway WebSocket URL used by MCP (default `ws://localhost:9742/ws`).                   |

## File layout

- Config: `~/.funnel/settings.json`
- PID: `~/.funnel/gateway.pid`
- Event log: `/tmp/funnel/events/*.jsonl` (auto-deleted after 30 days)
- Process log: `/tmp/funnel/gateway.log`

## Links

- [GitHub](https://github.com/interactive-inc/claude-funnel)
- [Issues](https://github.com/interactive-inc/claude-funnel/issues)
- Coding rules and design principles: [CLAUDE.md](https://github.com/interactive-inc/claude-funnel/blob/main/CLAUDE.md)
- Design notes: [`.docs/`](https://github.com/interactive-inc/claude-funnel/tree/main/.docs)

## Development

```bash
git clone https://github.com/interactive-inc/claude-funnel.git
cd claude-funnel
bun install
bun link            # register funnel / fnl globally
bun test            # run tests
bunx tsc -b         # type check
```

## License

MIT © Interactive Inc.
