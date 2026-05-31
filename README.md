[![npm](https://img.shields.io/npm/v/@interactive-inc/claude-funnel.svg)](https://www.npmjs.com/package/@interactive-inc/claude-funnel)
[![license](https://img.shields.io/npm/l/@interactive-inc/claude-funnel.svg)](./LICENSE)

A hub for AI coding agents. One long-running daemon owns all external connections; agents subscribe to named channels and react to events without you wiring up shell scripts and cron entries. Outbound replies travel back through the same connectors as MCP tools, so answering a message or commenting on an issue does not need a bash subshell.

The command is `funnel` (or the shorthand `fnl`).

Connectors today: Slack (Socket Mode), GitHub (poll via `gh`), Discord (Gateway), and cron schedules. Built around Claude Code; the architecture is agent-agnostic.

## Why funnel

A single agent session is great at one repository at one moment. The moment you want it to react to things — a chat mention, a new issue, a 9 AM standup — you end up gluing shell scripts, cron entries, and `bash -c "agent ..."` invocations together. There is no single place that says "who is listening to what, and who is allowed to reply where."

funnel is that place. Declare named subscription boxes (channels), attach connectors to them, launch the agent with a channel binding, and the daemon handles the rest:

- The daemon owns the external connections. Each one connects once, no matter how many agent sessions you start. A second agent does not open a second socket; both sessions subscribe to the same channel and the daemon fans events out.
- Inbound events arrive as MCP notifications, so the agent reacts in the session it is already running in.
- Outbound replies use MCP tools per connector — essentially synchronous (no bash, no CLI cold start).
- Listeners are supervised with health checks and automatic restart; a flaky connection or crashed poller recovers on its own.
- Multiple agents can share a channel (`fanout`) or compete for events as workers (`exclusive`) — the daemon decides who gets each event.

## Concepts

```
external sources                          outbound replies
(chat / source-control / cron)            (MCP tools per connector)
        │                                          │
        ▼                                          ▼
            daemon  (port 9742)
            routes events into channels
            serves replies through the same connectors
                        │
                        ▼  WebSocket / MCP (stdio)
                     agent  (subscribes to one channel)
```

Two concepts make up the transport model:

Channel — a named subscription box (transport only). Holds one or more connectors and a delivery mode; it does not carry launch flags. An agent session subscribes to exactly one channel. Delivery is `fanout` (every subscriber sees every event, the default) or `exclusive` (one event per subscriber, round-robin — for worker pools).

Connector — a single attachment from a channel to an external source. Four types ship today: `slack`, `gh`, `discord`, `schedule`. The first three are bidirectional (events in, replies out); `schedule` is one-way (cron ticks in).

Profile sits on top of that model as a launch convenience, not part of it — you never need one to run an agent (`fnl claude --channel <name>` is enough). It is a saved launch preset bundling `{ path, channelId, options, env, resume }` so `fnl claude --profile cto` reproduces a known setup: which directory to launch from, which channel to bind, and the launch recipe (args prepended to the claude argv, env layered under the process, session reuse). A profile carries a stable uuid `id` (the unit the PID file and the resumable session key off, so renaming it strands neither); `name` is just the handle you type. The first profile in the list is the default. Because a profile already binds a channel, `--profile` and `--channel` cannot be combined.

The daemon is where all external connections live. It runs on port 9742, bound to loopback (`127.0.0.1`) only so it is never reachable off-box; set `FUNNEL_HOST=0.0.0.0` to expose it deliberately (every privileged endpoint still requires the bearer token regardless). It supervises connectors with auto-restart, broadcasts events to subscribed agent sessions over WebSocket, and serves the reply API that MCP calls. Starting or stopping an agent never starts or stops external connections.

The MCP layer is a thin bridge into the agent. It subscribes to the bound channel over WebSocket (the daemon does the work) and exposes one tool per callable connector so the agent can reply back out.

## Requirements

- [Bun](https://bun.sh) 1.3 or later
- [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI
- A token or CLI for whichever external service you connect (Slack app, `gh` auth, Discord bot, etc.)

## Install

Per-repo (recommended for getting started — no global install, version pinned by the repo's lock file):

```bash
bun add -D @interactive-inc/claude-funnel
bunx funnel claude            # or `bunx funnel <any subcommand>`
```

Global (one CLI for every repo you touch):

```bash
bun add -g @interactive-inc/claude-funnel
funnel claude                 # or the `fnl` shorthand
```

The published package ships the built `dist/`, so either install makes `funnel` / `fnl` available immediately — no post-install step. The rest of the README uses `fnl` for brevity; swap in `bunx funnel` if you went the per-repo route.

## Quick start

Wire one source to one agent:

```bash
fnl channels add ops
fnl channels ops connectors add my-slack --type=slack \
    --bot-token=xoxb-... --app-token=xapp-...
fnl gateway start
fnl claude --channel ops
```

Every event the connector sees now arrives in the running agent session, and the agent can reply via the `my-slack` MCP tool.

Save it as a profile for one-command launches — the profile carries the launch recipe:

```bash
fnl profiles add cto --path=/repo/myapp --channel=ops --agent=pm --options="--brief"
fnl claude --profile cto         # cd + channel binding + recipe in one shot
```

Or drop a `funnel.json` in the repo and `fnl claude` (no args) inside the repo will use it:

```json
{
  "$schema": "./node_modules/@interactive-inc/claude-funnel/funnel.schema.json",
  "channels": [
    {
      "name": "ops",
      "connectors": [
        {
          "type": "slack",
          "name": "my-slack"
        }
      ]
    },
    {
      "name": "review"
    }
  ],
  "profiles": [
    {
      "channel": "ops",
      "options": ["--brief", "--agent", "pm"],
      "env": { "ANTHROPIC_MODEL": "claude-sonnet-4-6" }
    },
    {
      "channel": "review",
      "options": ["--agent", "reviewer"]
    }
  ]
}
```

`channels[]` is required and the first entry is the default. `fnl claude --channel review` picks one by name; `fnl claude` with no `--channel` uses the first.

A channel declares only transport — its `connectors` and delivery mode. The launch recipe lives on `profiles[]`: each profile binds to a channel by name and carries `options` (prepended to the claude argv before user-supplied CLI args, which still come last — use it for flags like `--brief`, `--agent <name>`, `--model <name>`), `env` (layered under the launched claude process — `process.env` from the launching shell wins on collision), and `resume`. `fnl claude` applies the first profile bound to the chosen channel.

The optional `connectors` array on a channel is the source of truth for that channel: missing connectors are created and connectors not declared are removed on launch. Connectors are matched by name. An absent `connectors` field leaves existing connectors alone.

A repo with a `funnel.json` is scoped to itself. On first launch funnel writes a stable `id` (uuid) to the top of `funnel.json` and keeps every byte of funnel state under `~/.funnel/projects/<id>/`, never touching the global `~/.funnel` — only the event log and temp files under `/tmp/funnel/` are shared. This scoping applies to every CLI command run in the repo, not just `fnl claude`. On launch the chosen channel's transport (`connectors`, delivery) is materialized into `~/.funnel/projects/<id>/settings.json`; the profile recipe is passed straight to the launcher and is not persisted there. Raw launches (`fnl claude --channel <name>` without funnel.json) bind transport only against the global `~/.funnel` and carry no recipe.

The optional top-level `$schema` points at the JSON Schema so editors can validate and autocomplete the file. The recommended reference for repos with a local install is `./node_modules/@interactive-inc/claude-funnel/funnel.schema.json` — it works without a network round-trip and editors do not need to prompt for trust. The same file is also published at `https://interactive-inc.github.io/open-claude-funnel/funnel.schema.json` (editors usually require explicit trust on first use), and `fnl schema > funnel.schema.json` regenerates a local copy on demand.

Connectors in `funnel.json` carry no tokens. A connector's token is set out of band and stored only in the repo-scoped settings:

- run `fnl channels <ch> connectors set <c> --bot-token=...` (etc.) in the repo to write it to `~/.funnel/projects/<id>/settings.json`
- or omit it — `fnl claude` prompts on a TTY at launch and saves the answer there; it carries over so later launches do not re-prompt. On non-TTY stdin the launch fails so CI / agent-spawned-agent runs do not hang

Only the `id` is ever written back to `funnel.json`; tokens never live in the repo.

Cron-driven agent runs:

```bash
fnl channels ops connectors add daily --type=schedule
fnl channels ops connectors daily schedules add morning \
    --cron="0 9 * * *" --prompt="morning standup"
```

Each tick fires the prompt into the channel. If the daemon was down at 9 AM, the next start catches up the missed slot (`meta.catchup = "true"`) for up to 24 hours.

Multiple agents on the same source — pick the delivery mode:

```bash
fnl channels add reviews                       # fanout (default): every agent sees every event
fnl channels add ingest --delivery=exclusive   # exclusive: one event per agent, round-robin
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
fnl profiles add <name> --path=<dir> --channel=<channel-name> \
                        [--agent=<name>] [--options="<argv>"] [--env="K=V,K2=V2"] [--no-resume]
fnl profiles <name>                          launch (alias for `<name> run`)
fnl profiles <name> run                      launch (sugar for `fnl claude --profile <name>`)
fnl profiles <name> set [--path=...] [--channel=...] \
                        [--agent=...] [--options="..."] [--env="..."] [--resume|--no-resume]
fnl profiles <name> as-default               move to the front of the list
fnl profiles rename <old> <new>
fnl profiles remove <name>

fnl claude                                   launch the first channel from ./funnel.json, or the default profile
fnl claude --channel <name>                  with funnel.json: pick that channel; without: raw launch
fnl claude --profile <name>                  launch a named profile (ignores funnel.json; cannot combine with --channel)
fnl claude [...]                             positionals and any flag other than -p / --profile / --channel
                                              (e.g. --agent, --resume, -c, --model) pass through to claude
fnl mcp                                      run as an MCP server (invoked from .mcp.json)

fnl gateway                                  status (default subcommand)
fnl gateway {start|stop|restart}             daemon lifecycle
fnl gateway run                              foreground daemon (developer mode)
fnl gateway logs [-n <N>]                    tail diagnostic log
fnl gateway listeners                        live registry (alive / dead)

fnl status                                   overall status (channels / profiles / gateway / clients)
fnl schema                                   print the JSON Schema for funnel.json (pipe to a file for editor support)
fnl update                                   `bun i -g @interactive-inc/claude-funnel`
fnl                                          (no args) show help

fnl --version
fnl --help                                   every subcommand has --help; verb-without-arg also returns help
```

`--channel` accepts the channel name (not the uuid). The CLI resolves it to a channel id before calling the engine.

## Outbound calls (MCP tools per connector)

When `fnl claude` launches the agent, the funnel MCP server connects to the daemon and reads the channel's connectors from `~/.funnel/settings.json`. For every callable connector (`slack` / `discord` / `gh`; `schedule` is one-way and skipped), MCP advertises one tool with the connector's name. The agent calls them like:

```jsonc
// MCP: tools/list returns
{ "name": "discord",   "inputSchema": { ... { method, path, body } ... } }
{ "name": "ops-slack", "inputSchema": { ... } }
{ "name": "gh-main",   "inputSchema": { ... } }

// agent calls
tools/call name="discord" arguments={
  "method": "POST",
  "path": "/channels/123/messages",
  "body": { "content": "got it" }
}
```

MCP forwards via HTTP `POST /channels/<channel>/connectors/<connector>/call` to the daemon, which dispatches through the connector's adapter. No bash subshell, no CLI cold start — replies are essentially synchronous.

To invoke a connector from outside an agent, the same path is reachable as `fnl channels <ch> connectors <c> request --method=<...> [--key=value ...]`.

## Data model

```
Channel    = { id, name, delivery, connectors[] }
        subscription box (transport only). delivery is `fanout` (every WS client sees every event)
        or `exclusive` (round-robin one client per event). carries no launch settings.

Connector  =
  | { type: "slack",    name, botToken, appToken }      Slack Socket Mode
  | { type: "gh",       name, pollInterval? }           GitHub (gh CLI, poll-based)
  | { type: "discord",  name, botToken }                Discord Gateway
  | { type: "schedule", name, entries[] }               cron-driven; entries = { id, cron, prompt, enabled?, catchupPolicy? }

Profile    = { id, name, path, channelId, options[], env, resume, sessionId? }
        named launch preset: where to launch (path), which channel to bind, and the launch recipe —
        options[] prepends to the claude argv, env layers under the process (process.env wins on
        collision), resume toggles session reuse. the first profile is the default. id is a stable
        uuid (the key the PID file and resumable session hang off, so a rename strands neither);
        name is the CLI handle. sessionId is execution state, not config — the claude session this
        profile last launched, written by the launcher and read back on the next resume.

LocalConfig = { id?, channels: ChannelSpec[], profiles?: ProfileSpec[] }
        per-repo file (funnel.json). channels[] required; first entry is default, --channel selects.
        id (uuid) is written back on first launch; this repo's funnel state lives under
        ~/.funnel/projects/<id>/ and the global ~/.funnel is never touched.

ChannelSpec = { name, connectors? }
        transport declaration (no id, since funnel.json declares by name). connectors materialize into
        the matching Channel in ~/.funnel/projects/<id>/settings.json on launch. Connectors carry no
        tokens; a token is set via the CLI or prompted on a TTY at launch and saved to that scoped settings.

ProfileSpec = { channel, options?, env?, resume? }
        launch recipe bound to a channel by name. applied inline on launch (the first spec bound to the
        chosen channel — selected by its channel binding, not by name); not persisted into the global
        profiles[] list.

Settings   = { channels[], profiles[] }                 → ~/.funnel/settings.json (global)
                                                          or ~/.funnel/projects/<id>/settings.json (per-repo funnel.json)
```

## File layout

Persistent state lives under `~/.funnel/`. Volatile logs and the event log live under `/tmp/funnel/`.

```
~/.funnel/
├── settings.json                                       global channels[] with nested connectors, profiles[]
├── projects/
│   └── <id>/                                           per-repo state for a repo with funnel.json
│       └── settings.json, gateway.token, claude/, ...  (same layout as the global root, scoped by funnel.json id)
├── gateway.pid                                         daemon PID
├── gateway.token                                       Bearer token for daemon HTTP / WS
├── claude/
│   └── <profile-id>.pid                                prevents double-launch of the same profile (keyed by profile id)
└── channels/
    └── <channel-id>/
        └── connectors/
            └── <connector-id>/
                └── state.json                          per-connector durable state (e.g. schedule lastFiredAt)

/tmp/funnel/
├── events.db                                           SQLite event log with replay-by-offset
├── funnel.log                                          diagnostic log (daemon lifecycle, listener boot, connects)
└── gateway.log                                         daemon stdout/stderr
```

Notes:

- Connector configuration is stored inline in `settings.json` (nested under the channel), not in a per-type directory. Per-connector durable state (e.g. `lastFiredAt` for schedule catch-up) lives under `channels/<channel-id>/connectors/<connector-id>/state.json` keyed by id, so renames do not lose state.
- `fnl gateway logs` tails `funnel.log` and renders it as YAML.

## Environment variables

| Variable               | Purpose                                                                                       |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `FUNNEL_CHANNEL_ID`    | Injected into the child process by `fnl claude`; the funnel MCP uses it to subscribe.         |
| `FUNNEL_PORT`          | Daemon port (default 9742).                                                                   |
| `FUNNEL_GATEWAY_URL`   | Daemon base URL used by MCP for both WS subscribe and HTTP reply (default `http://localhost:9742`). |
| `FUNNEL_GATEWAY_TOKEN` | Bearer token for the daemon HTTP / WS. Defaults to the contents of `~/.funnel/gateway.token`. |

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
const unsubscribe = server.onEvent(({ content, meta }) => {
  console.log(meta?.connector, content)    // in-process observer for every broadcast event
})
await server.stop()
unsubscribe()
```

Persistence and replay live behind the `FunnelEventLog` port. The default is a `SqliteFunnelEventLog` (durable across daemon restarts: it seeds the broadcaster's offset and serves reconnect replay). Inject `MemoryFunnelEventLog` — or any `FunnelEventLog` — to swap or disable durable replay; `onEvent` is a separate, write-only observation hook and does not replace it:

```ts
import { MemoryFunnelEventLog } from "@interactive-inc/claude-funnel"

const server = funnel.gatewayServer({ port: 9742, eventLog: new MemoryFunnelEventLog() })
```

The daemon exposes `/health`, `/status`, `/listeners*`, `/channels/:channel/connectors/:connector/call`, plus the `/ws?channel=<name>` WebSocket.

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

Project-scoped (auto): if you run `claude` inside this repo, the skill is picked up automatically — no install step.

Global (use the skill in any project): Claude Code does not currently provide a CLI to install skills from a remote URL, so copy the file into your personal skills directory:

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
