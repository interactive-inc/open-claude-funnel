// Claude Code integration sub-entry.
// FunnelClaude and its supporting classes are intentionally not part of the
// main "." entry — they depend on Claude Code's launch model which is optional.
// Use the Funnel facade (funnel.claude) for the standard path, or import
// directly here when you need fine-grained control.
export * from "@/engine/claude/claude"
export * from "@/engine/claude/channel-resolver"
export * from "@/engine/claude/gateway-controller"
export * from "@/engine/claude/mcp-installer"
export * from "@/engine/claude/session-store"
export * from "@/engine/claude/process-guard"
export * from "@/engine/claude/file-process-guard"
export * from "@/engine/mcp/mcp"
export * from "@/engine/mcp/channel-server"
export * from "@/engine/profiles/profiles"
export * from "@/engine/local-config/local-config"
export * from "@/engine/local-config/local-config-json-schema"
export * from "@/engine/local-config/local-config-schema"
export * from "@/engine/local-config/local-config-sync"
export * from "@/engine/local-config/local-config-writer"
export * from "@/engine/token-prompter/token-prompter"
export * from "@/engine/token-prompter/node-token-prompter"
export * from "@/engine/token-prompter/memory-token-prompter"
