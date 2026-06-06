// Doctor sub-entry: one-shot diagnose-and-fix orchestrator combining
// FunnelDiagnostics and FunnelRecovery. Hosts that want to drive the
// troubleshooting loop programmatically should compose this rather than the
// two underlying services directly.
export * from "@/services/doctor/funnel-doctor"
