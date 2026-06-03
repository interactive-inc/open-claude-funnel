// Local-config sub-entry: funnel.json reader / writer / syncer.
// funnel.json lives in the repo root and declares which channels and
// connectors a project uses. FunnelLocalConfigSync reconciles it with
// ~/.funnel/settings.json so the gateway daemon picks up changes on launch.
export * from "@/engine/local-config/local-config"
export * from "@/engine/local-config/local-config-json-schema"
export * from "@/engine/local-config/local-config-schema"
export * from "@/engine/local-config/local-config-sync"
export * from "@/engine/local-config/local-config-writer"
export * from "@/engine/token-prompter/token-prompter"
export * from "@/engine/token-prompter/node-token-prompter"
export * from "@/engine/token-prompter/memory-token-prompter"
