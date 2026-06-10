export const docsDebugging = `funnel docs debugging — diagnose and self-heal in one shot

Funnel ships with a single entry point that diagnoses every channel and, when
asked, applies safe self-healing fixes. Use this from the CLI (fnl doctor),
the MCP server (fnl_doctor tool), or the SDK (funnel.doctor.run()).

── the one command Claude needs ─────────────────────────────────────────────

  fnl doctor                          read-only diagnosis
  fnl doctor --fix --json             diagnose + apply safe fixes (idempotent)
  fnl doctor --fix --aggressive       also restart the gateway if needed

Return shape (same for CLI --json, MCP, SDK):

  { status: "ok" | "warn" | "error",
    message: "...",
    appliedActions: [
      { kind: "gateway:started" }
    | { kind: "gateway:already-running" }
    | { kind: "gateway:restarted" }
    | { kind: "listener:restarted",  channel, connector }
    | { kind: "listener:skipped",    channel, connector, reason }
    ],
    remainingIssues: [
      { channel, diagnosis: { status, message, nextActions, rootCause } }
    ],
    before: <diagnoseAll snapshot before fixing>,
    after:  <diagnoseAll snapshot after fixing> }

When status is "ok" you are done. Otherwise read remainingIssues for what
is still broken — usually a hint Claude can act on (configure a missing
connector, prompt the user to run \`fnl gateway start\` in a shell, etc).

── what fnl doctor --fix will and will not do ──────────────────────────────

Will (safe):
  - start the gateway if it is down (when run as a CLI; MCP cannot do this)
  - restart every dead listener across every channel

Will (aggressive, only with --aggressive):
  - also restart the gateway when safe fixes are not enough

Will not:
  - create channels / connectors / profiles
  - rotate tokens
  - change persistent config

── deeper inspection (rarely needed) ───────────────────────────────────────

  fnl debug events  --channel <name>     processed events with outcome
                                         (emitted | skip:type | skip:dedup | …)
  fnl debug dropped --channel <name>     skip:* events only
  fnl debug errors  --channel <name>     listener auth-failed / error events
  fnl debug replay  --channel <name>     replay a past event to test a fix

  fnl gateway logs                       daemon log stream
  fnl gateway sql --preset recent        ad-hoc SQL queries

── from inside MCP ─────────────────────────────────────────────────────────

Claude in any repo calls these tools without leaving MCP:

  fnl_doctor                       == fnl doctor (mode: off | safe | aggressive)
  fnl_status                       == lightweight snapshot
  fnl_debug                        == per-channel diagnosis
  fnl_recent_events                == fnl debug events
  fnl_dropped_events               == fnl debug dropped
  fnl_connection_errors            == fnl debug errors
  fnl_replay_event                 == fnl debug replay
  fnl_docs                         == fnl docs

── programmable API ───────────────────────────────────────────────────────

  const funnel = new Funnel()
  await funnel.doctor.run()             // read-only diagnosis
  await funnel.doctor.run("safe")       // diagnose + safe fixes
  await funnel.doctor.run("aggressive") // diagnose + safe + gateway restart

  // Building blocks (rarely needed; doctor orchestrates them)
  await funnel.diagnostics.diagnoseAll()
  await funnel.recovery.ensureGatewayRunning()
  await funnel.recovery.restartAllDeadListeners()

CLI, MCP, and the SDK share exactly one implementation — the CLI is a thin
presentation layer over funnel.doctor.

related: fnl docs gateway, fnl docs mcp, fnl docs recipes`
