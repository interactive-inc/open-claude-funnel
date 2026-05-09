[![npm](https://img.shields.io/npm/v/@interactive-inc/claude-funnel.svg)](https://www.npmjs.com/package/@interactive-inc/claude-funnel)
[![license](https://img.shields.io/npm/l/@interactive-inc/claude-funnel.svg)](./LICENSE)

A hub CLI that connects multiple Claude Code agents to external services (Slack / GitHub / Discord) and time-based triggers (cron). External events flow through subscription "channels" into Claude Code sessions, and outbound API calls from Claude are funneled through the same connectors.

The command is `funnel` or its shorthand `fnl`.

## Overview

```
External sources
(Slack / GitHub / Discord / cron)
            │
            ▼
        Connectors
       (per-type stores)
            │
            ▼
         Channels
   (subscription router)
            │
            ▼  WebSocket
       Gateway daemon
  (port 9742: WS /ws + listener supervisor)
            │
            ▼  MCP (stdio)
       Claude Code
  (events surfaced as <channel> tags;
   outbound calls go back through the
   same connectors via funnel MCP)
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

Schedule (cron) trigger:

```bash
# Register a schedule connector and a cron entry
fnl connectors add daily --type schedule
fnl connectors daily schedules add --cron "0 9 * * *" --prompt "morning standup"

# Attach it to a channel just like any other connector
fnl channels my-inbox connectors attach daily
```

## Commands

```
fnl connectors                              list
fnl connectors add <name> --type slack    --bot-token xoxb-... --app-token xapp-...
fnl connectors add <name> --type gh       [--poll-interval <sec>]
fnl connectors add <name> --type discord  --bot-token <token>
fnl connectors add <name> --type schedule
fnl connectors <name>                       show details
fnl connectors <name> set [--bot-token ...] [--app-token ...] [--poll-interval ...]
fnl connectors rename <old> <new>
fnl connectors remove <name>

fnl connectors <name> schedules                              list cron entries
fnl connectors <name> schedules add --cron "<expr>" --prompt "<text>" [--disabled]
fnl connectors <name> schedules remove <id>

fnl request slack   post <path> [body] --connector <name>   call Slack Web API
fnl request discord <method> <path> [body] --connector <name>   call Discord REST API

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
fnl gateway start / stop / restart / run / logs / listeners
fnl update                                  update funnel via bun i -g
fnl status                                  overall status (connectors / channels / profiles / repos / gateway)
fnl                                         (no args) launch the OpenTUI TUI

fnl --version
fnl --help        (every subcommand has --help)
```

## Data model

```
Connector =
  | { type: "slack",    name, botToken, appToken }
        Slack Socket Mode
  | { type: "gh",       name, pollInterval? }
        GitHub (gh CLI)
  | { type: "discord",  name, botToken }
        Discord Gateway
  | { type: "schedule", name, entries[] }
        cron-driven, entries = { id, cron, prompt, enabled }

Channel    = { name, connectors[] }
        subscription box

Repository = { name, path }
        extra

Profile    = { name, channel, repo?, subAgent?, envFiles? }
        launch profile

Settings = { channels[], repositories[], profiles[] }
        → ~/.funnel/settings.json

Connectors are stored per type, one file per connector:
        → ~/.funnel/connectors/<type>/<name>.(json|jsonl)
```

## Programmable API (Bun)

`funnel` is also usable as a library — the same `Funnel` facade the CLI uses is exported from the package root, with no CLI side effects.

```ts
import { Funnel } from "@interactive-inc/claude-funnel"

const funnel = new Funnel() // defaults to ~/.funnel + the local filesystem

funnel.connectors.add({
  type: "slack",
  name: "my-slack",
  botToken: "xoxb-...",
  appToken: "xapp-...",
})

funnel.channels.add({ name: "inbox", connectors: ["my-slack"] })

for (const c of funnel.connectors.list()) console.log(c.type, c.name)
```

All Funnel facets — `connectors` / `channels` / `profiles` / `repositories` / `schedule` / `gateway` / `listeners` / `mcp` / `claude` — are reachable from the same instance:

```ts
funnel.gateway.getStatus() // { running, pid, port }
await funnel.gateway.start() // spawns the daemon as a separate process

// Talk to the running daemon over HTTP — no-ops gracefully when offline
await funnel.listeners.list() // { state: "ok", listeners: [...] } | { state: "offline" }
await funnel.listeners.start("my-slack") // hot-start a single listener
await funnel.listeners.restart("my-slack")

await funnel.claude.launch({ channel: "inbox" })
funnel.mcp.install("/path/to/repo") // writes .mcp.json
```

Or run the gateway in-process (no daemon spawn — useful for tests, embedding, or custom hosts):

```ts
const server = funnel.gatewayServer({ port: 9742 })
await server.start() // starts Bun.serve (HTTP + WS), boots all connector listeners
server.getStatus() // { clients, channels: [...] }
server.getBroadcaster().broadcast("hello", { connector: "my-slack" })

// Subscribe to every event without going through the WebSocket
const unsubscribe = server.getBroadcaster().subscribe(({ content, meta }) => {
  console.log(meta?.connector, content)
})

await server.stop()
unsubscribe()
```

The gateway daemon exposes `/health`, `/status`, `/listeners`, and `/listeners/:name/{start,stop,restart}` over HTTP plus the `/ws?channel=<name>` WebSocket for MCP clients. There is no SPA; for a visual operator view, run `fnl` with no arguments to launch the OpenTUI TUI.

Every side-effecting boundary is a DI seam. For tests / sandbox use, swap them all with the in-memory implementations and Funnel will not touch real disk, real processes, real time, or real UUIDs:

```ts
import {
  Funnel,
  MemoryFunnelClock,
  MemoryFunnelFileSystem,
  MemoryFunnelIdGenerator,
  MemoryFunnelLogger,
  MemoryFunnelProcessRunner,
  MockFunnelSettingsReader,
} from "@interactive-inc/claude-funnel"

const funnel = new Funnel({
  store: new MockFunnelSettingsReader(),
  fs: new MemoryFunnelFileSystem(),
  process: new MemoryFunnelProcessRunner(),
  logger: new MemoryFunnelLogger(),
  clock: new MemoryFunnelClock({ start: new Date("2026-01-01T00:00:00Z") }),
  idGenerator: new MemoryFunnelIdGenerator({ prefix: "test" }),
  dir: "/sandbox/.funnel",
  tmpDir: "/sandbox/tmp",
})
```

Available abstractions (each has `Funnel*` interface, `Node*` default, and `Memory*` for tests): `FunnelFileSystem`, `FunnelProcessRunner`, `FunnelLogger`, `FunnelClock`, `FunnelIdGenerator`. Plus `NoopFunnelLogger` for silent operation.

The package ships TypeScript sources directly, so a Bun runtime is required. Importing `@interactive-inc/claude-funnel/cli` resolves to the CLI entry point (with side effects) — only do this if you're embedding the CLI rather than the library.

## Claude Code skill

This repo ships a Claude Code skill at `.claude/skills/funnel/SKILL.md`. It briefs Claude on the architecture and command groups, and tells it to defer flag-level details to `funnel <command> --help`.

### Project-scoped (auto)

If you run `claude` inside this repo, the skill is picked up automatically — no install step.

### Global (use the skill in any project)

Claude Code does not currently provide a CLI to install skills from a remote URL, so copy the file into your personal skills directory:

```bash
# from a clone of this repo
mkdir -p ~/.claude/skills/funnel
cp .claude/skills/funnel/SKILL.md ~/.claude/skills/funnel/
```

Or fetch it directly without cloning:

```bash
mkdir -p ~/.claude/skills/funnel
curl -fsSL https://raw.githubusercontent.com/interactive-inc/open-claude-funnel/main/.claude/skills/funnel/SKILL.md \
  -o ~/.claude/skills/funnel/SKILL.md
```

After this, Claude Code will load the skill in any session.

## Discord bot setup

- Create a bot in the Discord Developer Portal and obtain its token
- Enable `Message Content Intent` under Privileged Gateway Intents
- Invite the bot via OAuth2 → URL Generator with the `bot` scope and `View Channels` / `Send Messages` / `Read Message History` permissions

## Environment variables

| Variable             | Purpose                                                                           |
| -------------------- | --------------------------------------------------------------------------------- |
| `FUNNEL_CHANNEL_ID`  | Injected into the child process by `fnl claude`; funnel MCP uses it to subscribe. |
| `FUNNEL_PORT`        | Gateway port (default 9742).                                                      |
| `FUNNEL_GATEWAY_URL` | Gateway WebSocket URL used by MCP (default `ws://localhost:9742/ws`).             |

## File layout

- Config: `~/.funnel/settings.json` (channels / repositories / profiles)
- Connectors: `~/.funnel/connectors/<type>/<name>.(json|jsonl)`
  - `slack/<name>.json`, `gh/<name>.json`, `discord/<name>.json`
  - `schedule/<name>.jsonl` (one entry per line) and `schedule/<name>.state.json` (last-fired timestamps for catch-up)
- PID: `~/.funnel/gateway.pid`
- Claude PIDs: `~/.funnel/claude/<profile>.pid`
- Event log: `/tmp/funnel/events/*.jsonl` (auto-deleted after 30 days)
- Process log: `/tmp/funnel/gateway.log`

## Links

- [GitHub](https://github.com/interactive-inc/open-claude-funnel)
- [Issues](https://github.com/interactive-inc/open-claude-funnel/issues)
- Coding rules and design principles: [CLAUDE.md](https://github.com/interactive-inc/open-claude-funnel/blob/main/CLAUDE.md)
- Design notes: [`.docs/`](https://github.com/interactive-inc/open-claude-funnel/tree/main/.docs)

## Development

```bash
git clone https://github.com/interactive-inc/open-claude-funnel.git
cd claude-funnel
bun install
bun link            # register funnel / fnl globally
bun test            # run tests
bunx tsc -b         # type check
```

## License

MIT © Interactive Inc.
