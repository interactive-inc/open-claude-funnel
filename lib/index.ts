// Public API surface for the @interactive-inc/claude-funnel package.
//
// Sub-entries for targeted imports:
//   "@interactive-inc/claude-funnel/claude"        Claude Code integration (FunnelClaude, FunnelMcp)
//   "@interactive-inc/claude-funnel/gateway"       in-process gateway building blocks
//   "@interactive-inc/claude-funnel/profiles"      named launch profiles
//   "@interactive-inc/claude-funnel/local-config"  funnel.json reader / writer / syncer
//   "@interactive-inc/claude-funnel/diagnostics"   read-only event delivery diagnosis
//   "@interactive-inc/claude-funnel/recovery"      self-healing primitives
//   "@interactive-inc/claude-funnel/doctor"        one-shot diagnose + safe fixes
//   "@interactive-inc/claude-funnel/docs"          embedded documentation
//   "@interactive-inc/claude-funnel/event-log" generic structured event log
//   "@interactive-inc/claude-funnel/logger"        compatibility log names + diagnostic log
//   "@interactive-inc/claude-funnel/connectors/<type>"  per-type connector descriptor (slack | discord | gh | schedule)

// Facade
export * from "@/funnel"

// Engine — core domain
export * from "@/engine/channels/channels"
export * from "@/engine/settings/settings-reader"
export * from "@/engine/settings/settings-store"
export * from "@/engine/settings/mock-settings-reader"
export * from "@/engine/settings/settings-schema"

// Services — interface-layer orchestrators that compose engine primitives
// (read-only diagnosis, self-healing actions, the one-shot doctor, embedded docs).
export * from "@/services/diagnostics/funnel-diagnostics"
export * from "@/services/diagnostics/diagnostic-event"
export * from "@/services/recovery/funnel-recovery"
export * from "@/services/doctor/funnel-doctor"
export * from "@/engine/docs/funnel-docs"

// Engine — IO boundaries (abstract + Node / Memory implementations)
export * from "@/engine/fs/file-system"
export * from "@/engine/fs/node-file-system"
export * from "@/engine/fs/memory-file-system"

export * from "@/engine/process/process-runner"
export * from "@/engine/process/node-process-runner"
export * from "@/engine/process/memory-process-runner"

export * from "@/engine/logger/logger"
export * from "@/engine/logger/node-logger"
export * from "@/engine/logger/memory-logger"
export * from "@/engine/logger/noop-logger"

export * from "@/engine/time/clock"
export * from "@/engine/time/node-clock"
export * from "@/engine/time/memory-clock"

export * from "@/engine/id/id-generator"
export * from "@/engine/id/node-id-generator"
export * from "@/engine/id/memory-id-generator"

export * from "@/engine/http/http-client"
export * from "@/engine/http/node-http-client"
export * from "@/engine/http/memory-http-client"

export * from "@/engine/token-prompter/token-prompter"
export * from "@/engine/token-prompter/node-token-prompter"
export * from "@/engine/token-prompter/memory-token-prompter"

export * from "@/engine/error/on-funnel-error"
export * from "@/engine/error/funnel-error"

// Connectors — type-agnostic core surface only. Concrete connectors (Slack,
// Discord, GitHub, Schedule) — their descriptors, schemas, listeners, adapters —
// live behind the per-type sub-entries
// (`@interactive-inc/claude-funnel/connectors/<type>`), so `import { Funnel }`
// never pulls a connector's protocol code (Socket Mode / Gateway / poller) into
// the bundle. Pass descriptors at construction:
// `new Funnel({ connectors: [slackConnector()] })`.
export * from "@/engine/connectors/connector-adapter"
export * from "@/engine/connectors/connector-listener"
export * from "@/engine/connectors/base-connector-config"
export * from "@/engine/connectors/connector-descriptor"
export * from "@/engine/connectors/connector-registry"

// Per-connector config schemas and pure event types. These modules only
// depend on `zod` (already a root runtime dep) and pure type aliases — they
// never pull in @slack/bolt, discord.js, or flume sources. Consumers that
// hold typed config or event shapes can stay on the root import; the
// runtime listener/adapter classes still live behind subentries
// (`@interactive-inc/claude-funnel/connectors/<type>`).
export * from "@/engine/connectors/slack-connector-schema"
export * from "@/engine/connectors/slack-event-types"
export * from "@/engine/connectors/slack-event-processor"
export * from "@/engine/connectors/discord-connector-schema"
export * from "@/engine/connectors/gh-connector-schema"
export * from "@/engine/connectors/schedule-connector-schema"

// Gateway
export type { GatewayApp } from "@/gateway/routes"
export * from "@/gateway/gateway"
export * from "@/gateway/gateway-server"
export * from "@/gateway/channel-ws-url"
export * from "@/engine/http/gateway-base-url"
export * from "@/gateway/gateway-token"
export * from "@/gateway/broadcaster"
export * from "@/gateway/channel-publisher"
export * from "@/gateway/event-log/event-log"
export * from "@/gateway/event-log/sqlite-event-log"
export * from "@/gateway/event-log/memory-event-log"
export * from "@/engine/diagnostic-log/diagnostic-log"
export * from "@/engine/diagnostic-log/sqlite-diagnostic-log"
export * from "@/engine/diagnostic-log/memory-diagnostic-log"
export * from "@/engine/diagnostic-log/diagnostic-sql-reader"
export * from "@/gateway/listener-registry"
export * from "@/gateway/listeners-client"
export * from "@/gateway/publish-schema"
export * from "@/gateway/service-routes"
export { type Env as GatewayServerEnv } from "@/gateway/factory"
export type { GatewayEmitInput, GatewayRouteDeps } from "@/gateway/routes/route-deps"

// CLI — embeddable Hono app + argv translator
export * from "@/cli/factory"
export * from "@/cli/router/to-request"
export * from "@/cli/router/query-to-cli-args"
export { routes as cliRoutes } from "@/cli/routes"
export type { CliApp } from "@/cli/routes"
