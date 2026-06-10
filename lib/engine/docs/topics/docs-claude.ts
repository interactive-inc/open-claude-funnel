export const docsClaude = `funnel docs claude — launching Claude Code through funnel

\`fnl claude\` spawns Claude with the channel subscription wired in. The
resolution order is:

  1. --help / -h                            print help
  2. --profile + --channel                  error (mutually exclusive)
  3. --profile <name>                       use named profile (global first,
                                            then cwd funnel.json profiles[])
  4. funnel.json exists + --channel <name>  bind transport, no recipe
  5. funnel.json exists, no --channel       bind first channel in channels[]
  6. no funnel.json + --channel <name>      raw launch
  7. default global profile                 launch
  8. nothing matches                        print help

argv assembly when spawning Claude:

  [profile.options] [user CLI args] [MCP server flag]

  Same flag specified twice → last one wins.
  env assembled as: profile.env merged with process.env (process.env wins).

side effects on first launch in a repo:

  - writes funnel.json's top-level "id" (uuid) if missing — used to isolate
    state under ~/.funnel/projects/<id>/
  - installs an entry into the repo's .mcp.json (does not touch other entries)
  - if a connector has no token, TTY-prompts and saves to per-repo settings

double-launch guard:

  Same profile cannot be launched twice — protected by a PID file under
  ~/.funnel/projects/<id>/profiles/<profile-id>/pid. Stale PID files are
  cleaned up automatically when the recorded process is gone.

related: fnl docs profiles, fnl docs mcp, fnl docs local-config`
