[![npm](https://img.shields.io/npm/v/@interactive-inc/claude-funnel.svg)](https://www.npmjs.com/package/@interactive-inc/claude-funnel)
[![license](https://img.shields.io/npm/l/@interactive-inc/claude-funnel.svg)](./LICENSE)

A hub CLI that connects multiple Claude Code agents to external services (Slack / GitHub / Discord) and time-based triggers (cron). External events flow through subscription "channels" into Claude Code sessions, and outbound API calls from Claude are funneled through the same connectors as MCP tools.

The command is `funnel` or its shorthand `fnl`.

## Overview

```
External sources                       Outbound calls
(Slack / GitHub / Discord / cron)     (Claude → MCP tools per connector)
            │                                       ▲
            ▼                                       │
        Channels (with nested per-type connectors)
                    │
                    ▼  WebSocket
              Gateway daemon
        (port 9742: WS /ws + listener supervisor + reply API)
                    │
                    ▼  MCP (stdio)
              Claude Code
   (events arrive as <channel> notifications;
    one MCP tool is exposed per configured connector
    so Claude can reply / send / call APIs without bash)
```

## Requirements

- [Bun](https://bun.sh) 1.3 or later (runtime — used at install time to build the CLI bundle and at runtime to execute it)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI
- A Slack / GitHub / Discord token or CLI, depending on which connectors you use

## Install

```bash
bun add -g @interactive-inc/claude-funnel
```

The published package already ships the built `dist/`, so `bun add -g` makes `funnel` / `fnl` available immediately — no postinstall step.

## Quick start

```bash
# Create a subscription box (channel) and attach a connector
fnl channels add ops
fnl channels ops connectors add my-slack --type=slack \
    --bot-token=xoxb-... --app-token=xapp-...

# Start the gateway (connects to Slack Socket Mode and surfaces events)
fnl gateway start

# Launch Claude with a raw channel binding (no profile required)
fnl claude --channel ops

# Or save it as a profile and launch by name
fnl profiles add cto --path=/repo/myapp --sub-agent=cto --channel=ops
fnl claude --profile cto
```

Schedule (cron) trigger:

```bash
# A schedule connector contains many cron entries
fnl channels ops connectors add daily --type=schedule
fnl channels ops connectors daily schedules add morning \
    --cron="0 9 * * *" --prompt="morning standup"
```

## CLI surface

Connectors live nested inside their owning channel. Every CLI verb (`add` / `set` / `remove` / `rename` / `as-default` / `request`) maps to `POST` plus the verb in the URL — there is no method-stripping, so the same word stays visible in both shell and HTTP form. Read paths (no verb) stay `GET`.

```text
fnl channels                                 list
fnl channels add <name> [--delivery=fanout|exclusive]
fnl channels <name>                          show details
fnl channels remove <name>
fnl channels rename <old> <new>              (also `fnl channels <old> rename <new>`)
fnl channels <name> set delivery <mode>

fnl channels <ch> connectors                 list
fnl channels <ch> connectors add <c> --type=slack    --bot-token=xoxb-... --app-token=xapp-...
fnl channels <ch> connectors add <c> --type=gh       [--poll-interval=<sec>]
fnl channels <ch> connectors add <c> --type=discord  --bot-token=<token>
fnl channels <ch> connectors add <c> --type=schedule
fnl channels <ch> connectors <c>             show config
fnl channels <ch> connectors set <c> [--bot-token=...] [--app-token=...] [--poll-interval=...]
fnl channels <ch> connectors remove <c>
fnl channels <ch> connectors rename <c> <new>
fnl channels <ch> connectors <c> request --method=<api.method> [--key=value ...]

fnl channels <ch> connectors <c> schedules                        list cron entries
fnl channels <ch> connectors <c> schedules add <id> --cron="<expr>" --prompt="<text>" \
                                  [--enabled=true] [--catchup-policy=latest|all|skip]
fnl channels <ch> connectors <c> schedules remove <id>

fnl profiles                                 list (first entry is the default)
fnl profiles add <name> --path=<dir> --sub-agent=<agent> --channel=<channel-name>
fnl profiles <name>                          launch (alias for `<name> run`)
fnl profiles <name> run                      launch (sugar for `fnl claude --profile <name>`)
fnl profiles <name> set [--path=...] [--sub-agent=...] [--channel=...]
fnl profiles <name> as-default               move to the front of the list
fnl profiles rename <old> <new>
fnl profiles remove <name>

fnl claude                                   launch the default profile
fnl claude --profile <name>                  launch a named profile
fnl claude --channel <name>                  raw launch (no profile, cwd = current dir)
fnl mcp                                      run as an MCP server (invoked from .mcp.json)

fnl gateway                                  status (default subcommand)
fnl gateway {start|stop|restart}             daemon lifecycle
fnl gateway run                              foreground daemon (developer mode)
fnl gateway logs [-n <N>]                    tail diagnostic log
fnl gateway listeners                        live registry (alive / dead)

fnl status                                   overall status (channels / profiles / gateway / clients)
fnl update                                   `bun i -g @interactive-inc/claude-funnel`
fnl                                          (no args) launch the OpenTUI dashboard

fnl --version
fnl --help                                   every subcommand has --help; verb-without-arg also returns help
```

`--channel` accepts the channel **name** (not the uuid). The CLI resolves it to a channel id before calling the engine.

## Reply path: MCP tools per connector

When `fnl claude` launches Claude Code, the funnel MCP server connects to the gateway and reads the channel's connectors from `~/.funnel/settings.json`. For every callable connector (`slack` / `discord` / `gh`; `schedule` is one-way and skipped), the MCP advertises one tool with the connector's name. Claude can call them like:

```jsonc
// MCP: tools/list returns
{ "name": "discord",   "inputSchema": { ... { method, path, body } ... } }
{ "name": "ops-slack", "inputSchema": { ... } }
{ "name": "gh-main",   "inputSchema": { ... } }

// Claude calls
tools/call name="discord" arguments={
  "method": "POST",
  "path": "/channels/123/messages",
  "body": { "content": "got it" }
}
```

The MCP forwards via HTTP `POST /channels/<channel>/connectors/<connector>/call` to the gateway daemon, which dispatches through the existing `FunnelChannels.call()` adapter. No bash subshell, no CLI cold start — replies are essentially synchronous.

If you need to invoke a connector from outside Claude, the same path is reachable as `fnl channels <ch> connectors <c> request --method=<...> [--key=value ...]`.

## Data model

```
Channel    = { id, name, delivery, connectors[] }
        subscription box; `delivery` is `fanout` (default; every WS client sees every event)
        or `exclusive` (round-robin one client per event)

Connector  =
  | { type: "slack",    name, botToken, appToken }
        Slack Socket Mode
  | { type: "gh",       name, pollInterval? }
        GitHub (gh CLI, poll-based)
  | { type: "discord",  name, botToken }
        Discord Gateway
  | { type: "schedule", name, entries[] }
        cron-driven; entries = { id, cron, prompt, enabled?, catchupPolicy? }

Profile    = { name, path, subAgent, channelId }
        named launch preset; the first profile in the list is the default

Settings   = { channels[], profiles[] }
        → ~/.funnel/settings.json
```

Connectors are stored per type, one file per connector, under `~/.funnel/connectors/<type>/<name>.(json|jsonl)` so adding or retiring a type is contained to its own subdirectory.

## Programmable API (Bun)

`funnel` is also usable as a library — the same `Funnel` facade the CLI uses is exported from the package root. The constructor is fully lazy: `new Funnel()` records its props and freezes, no disk / process / network access happens until a method is called.

```ts
import { Funnel } from "@interactive-inc/claude-funnel"

const funnel = new Funnel() // defaults to ~/.funnel + /tmp/funnel on the local filesystem

funnel.paths
// → { dir: "/Users/you/.funnel", tmpDir: "/tmp/funnel", settings: "/Users/you/.funnel/settings.json" }

const channel = funnel.channels.add({ name: "inbox" })

funnel.channels.addConnector("inbox", {
  type: "slack",
  name: "my-slack",
  botToken: "xoxb-...",
  appToken: "xapp-...",
})

for (const c of funnel.channels.list()) console.log(c.name, c.connectors.length)
```

Every facet — `channels` / `profiles` / `gateway` / `gatewayServer` / `gatewayToken` / `listeners` / `mcp` / `claude` / `factory` / `store` / `process` / `logger` / `paths` — is reachable from the same instance:

```ts
funnel.gateway.getStatus()       // { running, pid, port }
await funnel.gateway.start()     // spawns the daemon as a separate process

await funnel.listeners.list()    // talks to the running daemon over HTTP
await funnel.listeners.start("inbox", "my-slack")
await funnel.listeners.restart("inbox", "my-slack")

await funnel.claude.launch({ channel: "inbox" })
funnel.mcp.install("/path/to/repo")     // writes .mcp.json
```

Run the gateway in-process (no daemon spawn — useful for tests or embedding):

```ts
const server = funnel.gatewayServer({ port: 9742 })
await server.start()                       // Bun.serve (HTTP + WS) + listener supervisor
const unsubscribe = server.getBroadcaster().subscribe(({ content, meta }) => {
  console.log(meta?.connector, content)
})
await server.stop()
unsubscribe()
```

The gateway daemon exposes `/health`, `/status`, `/listeners*`, `/channels/:channel/connectors/:connector/call`, plus the `/ws?channel=<name>` WebSocket.

### Sandboxed Funnel

`Funnel.inMemory()` returns a Funnel pre-wired with Memory implementations for every IO boundary — useful for tests and ad-hoc experiments. Pass any subset of `props` to override individual seams:

```ts
import { Funnel } from "@interactive-inc/claude-funnel"

const funnel = Funnel.inMemory()        // touches no real disk, processes, clock, or UUIDs
funnel.channels.add({ name: "inbox" })  // mutates the in-memory store
```

The longhand form (for fine-grained control) is still available:

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

Available abstractions (each has `Funnel*` interface, `Node*` default, and `Memory*` for tests): `FunnelFileSystem`, `FunnelProcessRunner`, `FunnelLogger`, `FunnelClock`, `FunnelIdGenerator`. Plus `NoopFunnelLogger` for silent operation and `MockFunnelSettingsReader` for an in-memory settings store.

### Embedding the CLI

The same Hono app that backs `fnl` is published as `createCliApp(funnel)` — pass any `Funnel` instance to bind a custom store / boundaries to the routes. The pair `toRequest` (argv → request) and `queryToCliArgs` (URL search params → CLI flags) lets you drive the app programmatically:

```ts
import { Funnel, createCliApp, toRequest } from "@interactive-inc/claude-funnel"

const app = createCliApp(Funnel.inMemory())
const { method, url } = toRequest(["channels", "add", "inbox"])
const res = await app.request(url, { method })
console.log(await res.text())
```

`cliApp` is the same app pre-wired to `new Funnel()` for callers who just want the default. The middleware sets the chosen Funnel onto `c.var.funnel`; the matching `Env` type is exported for composing custom routes that share the same context variable.

### Launching the TUI

`launchTui(funnel)` boots the OpenTUI dashboard against any `Funnel` instance — pass `Funnel.inMemory()` to drive it against a fake state, or your production funnel for a live view.

```ts
import { Funnel, launchTui } from "@interactive-inc/claude-funnel"

await launchTui(new Funnel())
```

### Validating connector configs

Each connector type publishes its Zod schema, so consumers can parse external configs (JSON files, API payloads, etc.) before handing them to `addConnector`. The discriminated union `connectorConfigSchema` covers the whole set.

```ts
import {
  connectorConfigSchema,
  slackConnectorSchema,
  type SlackConnectorConfig,
} from "@interactive-inc/claude-funnel"

const slack: SlackConnectorConfig = slackConnectorSchema.parse(json)
const any = connectorConfigSchema.parse(json)   // narrows by `type`
```

### Packaging

The published package ships a bundled library entry (`dist/index.js`) plus generated declarations (`dist/**/*.d.ts`), so consumers do not need a matching tsconfig paths setup to resolve `@/...` imports. The `fnl` / `funnel` bin entries point to a separately bundled `dist/bin.js`. Import `@interactive-inc/claude-funnel/bin` only if you are embedding the CLI binary rather than the library.

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

| Variable               | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `FUNNEL_CHANNEL_ID`    | Injected into the child process by `fnl claude`; the funnel MCP uses it to subscribe.         |
| `FUNNEL_PORT`          | Gateway port (default 9742).                                                                  |
| `FUNNEL_GATEWAY_URL`   | Gateway base URL used by MCP for both WS subscribe and HTTP reply (default `http://localhost:9742`). |
| `FUNNEL_GATEWAY_TOKEN` | Bearer token for the gateway HTTP / WS. Defaults to the contents of `~/.funnel/gateway.token`. |

## File layout

- Config: `~/.funnel/settings.json` (channels with nested connectors / profiles)
- Connectors: `~/.funnel/connectors/<type>/<name>.(json|jsonl)`
  - `slack/<name>.json`, `gh/<name>.json`, `discord/<name>.json`
  - `schedule/<name>.jsonl` (one entry per line) and `schedule/<name>.state.json` (last-fired timestamps for catch-up)
- Gateway PID: `~/.funnel/gateway.pid`, token: `~/.funnel/gateway.token`
- Claude PIDs: `~/.funnel/claude/<profile>.pid`
- Event store: `/tmp/funnel/events/events.db` (SQLite; broadcaster events with replay-by-seq)
- Diagnostic log: `/tmp/funnel/funnel.log` (gateway lifecycle, connect/disconnect, listener boot — what `funnel gateway logs` tails as YAML)
- Process log: `/tmp/funnel/gateway.log` (daemon stdout/stderr)

## Links

- [GitHub](https://github.com/interactive-inc/open-claude-funnel)
- [Issues](https://github.com/interactive-inc/open-claude-funnel/issues)
- Coding rules and design principles: [CLAUDE.md](https://github.com/interactive-inc/open-claude-funnel/blob/main/CLAUDE.md)

## Development

```bash
git clone https://github.com/interactive-inc/open-claude-funnel.git
cd open-claude-funnel
bun install         # install deps (no auto-build)
make build          # produce dist/ — run this once after install
bun link            # symlinks fnl / funnel → dist/bin.js
make build          # rebuild library + CLI after editing
make build-lib      # library only (vp pack)
make build-bin      # CLI / daemon only (bun build --minify)
make clean          # remove dist/
bun test            # run tests
bunx tsc -b         # type check
bun lib/bin.ts ...  # run the cli from source (no build) for fast iteration
```

## License

MIT © Interactive Inc.
