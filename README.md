[![npm](https://img.shields.io/npm/v/@interactive-inc/claude-funnel.svg)](https://www.npmjs.com/package/@interactive-inc/claude-funnel)
[![license](https://img.shields.io/npm/l/@interactive-inc/claude-funnel.svg)](./LICENSE)

A hub CLI that connects multiple Claude Code agents to external services (Slack / GitHub / Discord) and time-based triggers (cron). External events flow into subscription "channels" and arrive at Claude Code over MCP. Outbound API calls from Claude go back through the same connectors as MCP tools, so replying to a Slack thread or commenting on a GitHub issue does not need a bash subshell.

The command is `funnel` or its shorthand `fnl`.

## Why funnel

A single Claude Code session is great at one repo at one moment. The moment you want it to react to things — a Slack mention, a new GitHub issue, a 9 AM standup — you end up gluing shell scripts, cron entries and `bash -c "claude ..."` together, and there is no single place that says "who is listening to what, and who is allowed to reply where."

`funnel` is that place. You configure named subscription boxes (channels), attach connectors to them, launch Claude with a channel binding, and the daemon does the rest:

- The gateway daemon owns the external connections. Slack Socket Mode, the Discord Gateway, GitHub polling — they connect once, from the daemon, no matter how many Claude sessions you start. Launching a second Claude does not open a second Slack socket; both sessions just subscribe to the same channel and the daemon routes events to them
- Inbound events arrive as MCP notifications, so Claude reacts in the same session it is already running in
- Outbound replies use MCP tools per connector, so they are essentially synchronous (no bash, no CLI cold start)
- Listeners are supervised with health checks and auto-restart, so a flaky Slack connection or a crashed poller recovers on its own
- Multiple Claudes can share the same channel (`fanout`) or compete for events as workers (`exclusive`) — the daemon decides who gets each event

If you have ever wanted "Slack-driven Claude" or "cron-driven Claude" without writing a dispatcher, this is it.

## Concepts

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
```

Channel — a named subscription box. Holds one or more connectors. Each Claude session subscribes to exactly one channel. Delivery mode is `fanout` (every subscriber sees every event; the default) or `exclusive` (round-robin one subscriber per event, for worker pools).

Connector — a single attachment to an external source. Four types ship: `slack` (Socket Mode push), `gh` (GitHub poll via the `gh` CLI), `discord` (Gateway push), and `schedule` (cron tick). Connectors are nested inside their owning channel.

Profile — a named launch preset for Claude. Bundles `{ path, sub-agent, channel }` so `fnl claude --profile cto` reproduces a known setup. The first profile in the list is the default.

Gateway daemon — the long-running process and the sole owner of external connections. Each connector connects from here exactly once; Claude sessions never open their own. Hosts the connector listeners with auto-restart, broadcasts events to subscribed clients, and serves the outbound reply API. Runs on port 9742 by default.

MCP — the bridge into Claude Code. A thin client: subscribes to one channel over WebSocket (the daemon does the real work) and surfaces one MCP tool per callable connector so Claude can call back out. Starting or stopping a Claude session does not start or stop external connections.

## Requirements

- [Bun](https://bun.sh) 1.3 or later
- [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI
- A Slack / GitHub / Discord token or CLI, depending on which connectors you use

## Install

```bash
bun add -g @interactive-inc/claude-funnel
```

The published package already ships the built `dist/`, so `bun add -g` makes `funnel` / `fnl` available immediately — no postinstall step.

## Quick start

Wire Slack to Claude:

```bash
fnl channels add ops
fnl channels ops connectors add my-slack --type=slack \
    --bot-token=xoxb-... --app-token=xapp-...
fnl gateway start
fnl claude --channel ops
```

From now on every Slack event the bot can see arrives in the running Claude session, and Claude can reply via the `my-slack` MCP tool.

Save it as a profile for one-command launches:

```bash
fnl profiles add cto --path=/repo/myapp --sub-agent=cto --channel=ops
fnl claude --profile cto         # cd /repo/myapp + sub-agent + channel binding
```

Cron-driven Claude:

```bash
fnl channels ops connectors add daily --type=schedule
fnl channels ops connectors daily schedules add morning \
    --cron="0 9 * * *" --prompt="morning standup"
```

Each tick fires the prompt into the channel. If the daemon was down at 9 AM, the next start catches up the missed slot (`meta.catchup = "true"`) for up to 24 hours.

Multiple Claudes on the same source — pick the delivery mode:

```bash
# default: fanout — every Claude on the channel sees every event
fnl channels add reviews

# worker pool — each event is handled by exactly one Claude, round-robin
fnl channels add ingest --delivery=exclusive
```

## CLI surface

Connectors live nested inside their owning channel. Every write verb (`add` / `set` / `remove` / `rename` / `as-default` / `request`) maps to `POST` plus the verb in the URL — the same word stays visible in shell and HTTP form. Read paths stay `GET`.

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

`--channel` accepts the channel name (not the uuid). The CLI resolves it to a channel id before calling the engine.

## Outbound calls (MCP tools per connector)

When `fnl claude` launches Claude Code, the funnel MCP server connects to the gateway and reads the channel's connectors from `~/.funnel/settings.json`. For every callable connector (`slack` / `discord` / `gh`; `schedule` is one-way and skipped), the MCP advertises one tool with the connector's name. Claude calls them like:

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
        subscription box; delivery is `fanout` (every WS client sees every event)
        or `exclusive` (round-robin one client per event)

Connector  =
  | { type: "slack",    name, botToken, appToken }     Slack Socket Mode
  | { type: "gh",       name, pollInterval? }           GitHub (gh CLI, poll-based)
  | { type: "discord",  name, botToken }                Discord Gateway
  | { type: "schedule", name, entries[] }               cron-driven; entries = { id, cron, prompt, enabled?, catchupPolicy? }

Profile    = { name, path, subAgent, channelId }
        named launch preset; the first profile in the list is the default

Settings   = { channels[], profiles[] }                 → ~/.funnel/settings.json
```

## File layout

Persistent state lives under `~/.funnel/`. Volatile logs and the event store live under `/tmp/funnel/`.

```
~/.funnel/
├── settings.json                                       channels[] with nested connectors, profiles[]
├── gateway.pid                                         daemon PID
├── gateway.token                                       Bearer token for gateway HTTP / WS
├── claude/
│   └── <profile>.pid                                   prevents double-launch of the same profile
└── channels/
    └── <channel-id>/
        └── connectors/
            └── <connector-id>/
                └── state.json                          per-connector durable state (e.g. schedule lastFiredAt)

/tmp/funnel/
├── events/events.db                                    SQLite event store with replay-by-seq
├── funnel.log                                          diagnostic log (gateway lifecycle, listener boot, connects)
└── gateway.log                                         daemon stdout/stderr
```

Notes

- Connector configuration is stored inline in `settings.json` (nested under the channel), not in a per-type directory. Per-connector durable state (e.g. `lastFiredAt` for schedule catch-up) lives under `channels/<channel-id>/connectors/<connector-id>/state.json` keyed by id, so renames do not lose state.
- `funnel gateway logs` tails `funnel.log` and renders it as YAML.

## Environment variables

| Variable               | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `FUNNEL_CHANNEL_ID`    | Injected into the child process by `fnl claude`; the funnel MCP uses it to subscribe.         |
| `FUNNEL_PORT`          | Gateway port (default 9742).                                                                  |
| `FUNNEL_GATEWAY_URL`   | Gateway base URL used by MCP for both WS subscribe and HTTP reply (default `http://localhost:9742`). |
| `FUNNEL_GATEWAY_TOKEN` | Bearer token for the gateway HTTP / WS. Defaults to the contents of `~/.funnel/gateway.token`. |

## Discord bot setup

- Create a bot in the Discord Developer Portal and obtain its token
- Enable `Message Content Intent` under Privileged Gateway Intents
- Invite the bot via OAuth2 → URL Generator with the `bot` scope and `View Channels` / `Send Messages` / `Read Message History` permissions

## Programmable API (Bun)

`funnel` is also usable as a library — the same `Funnel` facade the CLI uses is exported from the package root. The constructor is fully lazy: `new Funnel()` records its props and freezes; no disk / process / network access happens until a method is called.

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

Project-scoped (auto). If you run `claude` inside this repo, the skill is picked up automatically — no install step.

Global (use the skill in any project). Claude Code does not currently provide a CLI to install skills from a remote URL, so copy the file into your personal skills directory:

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

## Links

- [GitHub](https://github.com/interactive-inc/open-claude-funnel)
- [Issues](https://github.com/interactive-inc/open-claude-funnel/issues)
- Coding rules and design principles: [CLAUDE.md](https://github.com/interactive-inc/open-claude-funnel/blob/main/CLAUDE.md)

## License

MIT © Interactive Inc.
