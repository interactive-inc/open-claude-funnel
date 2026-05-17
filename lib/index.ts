// Public API surface for the @interactive-inc/claude-funnel package.
// Organized by layer so consumers can find what they need at a glance.

// Facade
export * from "@/funnel"

// Engine — domain
export * from "@/engine/channels/channels"
export * from "@/engine/claude/claude"
export * from "@/engine/mcp/mcp"
export * from "@/engine/mcp/channel-server"
export * from "@/engine/profiles/profiles"
export * from "@/engine/settings/settings-reader"
export * from "@/engine/settings/settings-store"
export * from "@/engine/settings/mock-settings-reader"
export * from "@/engine/settings/settings-schema"

// Engine — boundaries (abstract + Node / Memory implementations)
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

// Connectors
export * from "@/connectors/connector-factory"
export * from "@/connectors/connector-config-schema"
export * from "@/connectors/connector-listener"
export * from "@/connectors/discord-connector-schema"
export * from "@/connectors/gh-connector-schema"
export * from "@/connectors/schedule-connector-schema"
export * from "@/connectors/slack-connector-schema"
export * from "@/connectors/slack-event-processor"

// Gateway
export * from "@/gateway/gateway"
export * from "@/gateway/gateway-server"
export * from "@/gateway/gateway-token"
export * from "@/gateway/broadcaster"
export * from "@/gateway/channel-publisher"
export * from "@/gateway/funnel-event-store"
export * from "@/gateway/listener-supervisor"
export * from "@/gateway/listeners-client"
export * from "@/gateway/publish-schema"

// CLI — embeddable Hono app + argv translator
export * from "@/cli/factory"
export * from "@/cli/router/to-request"
export * from "@/cli/router/query-to-cli-args"
export { app as cliApp, createCliApp } from "@/cli/routes"

// TUI — launcher (consumers can spawn the OpenTUI dashboard with their own Funnel)
export * from "@/tui/tui"
