// Claude Code integration sub-entry.
// FunnelClaude and its supporting classes are intentionally not part of the
// main "." entry — they depend on Claude Code's launch model which is optional.
// Use the Funnel facade (funnel.claude) for the standard path, or import
// directly here when you need fine-grained control.
//
// FunnelLocalConfig* and token-prompter classes live under the dedicated
// "./local-config" sub-entry — picking one home per class avoids the bundler
// shipping each implementation twice and the resulting cross-subentry
// `instanceof` foot-gun.
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
