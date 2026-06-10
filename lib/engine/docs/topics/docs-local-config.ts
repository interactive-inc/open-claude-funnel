export const docsLocalConfig = `funnel docs local-config — the per-repo funnel.json

funnel.json lives at the repo root and is committed alongside the code. It
declares channels (transport) and profiles (launch recipes) so a clone of the
repo can launch Claude with the same wiring.

shape:

  LocalConfig = { id?, channels: ChannelSpec[], profiles?: ProfileSpec[] }
  ChannelSpec = { name, connectors? }
  ProfileSpec = { name, channel, options?, env?, resume? }

what funnel writes back to funnel.json:

  Only the top-level "id" (uuid), written once on first launch. It is the
  state-isolation key — every funnel state for this repo lives under
  ~/.funnel/projects/<id>/. Renaming the repo or moving it does not break
  this binding.

what funnel never writes to funnel.json:

  tokens. funnel.json is commit-safe. Tokens live in:

    ~/.funnel/projects/<id>/settings.json   per-repo, set via CLI or TTY prompt

how it is read:

  All CLI commands check for funnel.json in cwd. If found, FUNNEL_DIR is
  pointed at the per-repo root before anything else loads, so routing,
  dispatchClaude, MCP, and the daemon all share the same state.

generating the schema for editors:

  fnl schema > funnel.schema.json

  # then in funnel.json:
  { "$schema": "./funnel.schema.json", ... }

related: fnl docs profiles, fnl docs channels, fnl schema`
