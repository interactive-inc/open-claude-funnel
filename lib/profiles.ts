// Profiles sub-entry: named launch presets for fnl claude.
// Each profile carries a channel binding, a launch recipe (options / env),
// and an optional session-resume flag. FunnelProfiles persists them in
// ~/.funnel/settings.json via the injected FunnelSettingsReader.
export * from "@/engine/profiles/profiles"
