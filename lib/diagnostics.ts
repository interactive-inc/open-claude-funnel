// Diagnostics sub-entry: programmable diagnosis of event delivery.
// FunnelDiagnostics depends on narrow interfaces (channel registry, gateway
// probe, token reader, publisher), so embedding hosts can wire it without
// pulling the full Funnel facade.
export * from "@/services/diagnostics/funnel-diagnostics"
export * from "@/services/diagnostics/diagnostic-event"
