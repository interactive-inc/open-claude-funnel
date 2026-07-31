// Recovery sub-entry: self-healing actions (gateway / listeners).
// FunnelRecovery depends only on narrow gateway / listener interfaces, so it
// composes with custom gateway implementations or alternative listener
// registries.
export * from "@/services/recovery/funnel-recovery"
