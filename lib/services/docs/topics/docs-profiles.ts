export const docsProfiles = `funnel docs profiles — launch presets for Claude

A profile is a saved recipe for launching Claude bound to a specific channel.
Profiles are NOT required — \`fnl claude --channel <name>\` works without one.
Use profiles when you want to save options / env / resume settings.

shape:

  { id, name, path, channelId, options[], env, resume, sessionId? }

  id          uuid primary key; survives rename (used as the key for PID file
              and sessionId so renaming a profile does not orphan its state)
  name        display label; what --profile <name> matches
  path        cwd to enter before spawning Claude
  channelId   the channel this profile binds
  options     argv prepended to claude (e.g. --agent, --brief, --model)
  env         env vars for Claude; process.env wins on collision
  resume      whether to reuse the saved sessionId on next launch
  sessionId   execution state — last spawned Claude session id (not config)

global vs local:

  global profiles  ~/.funnel/settings.json  →  --profile <name> always works
  local profiles   funnel.json profiles[]   →  per-repo recipe, only resolved
                                               when cwd contains the file

mutual exclusion:

  --profile and --channel are mutually exclusive. A profile already binds a
  channel, so combining them is an error.

operations:

  fnl profiles                              list
  fnl profiles add <name>                   create
  fnl profiles set <name>                   update
  fnl profiles remove <name>                delete
  fnl profiles rename <old> <new>           rename (id-stable)
  fnl profiles <name> as-default            mark as default for fnl claude
  fnl profiles <name> run                   spawn Claude using this profile
  fnl claude --profile <name>               equivalent to <name> run

related: fnl docs claude, fnl docs channels`
