type ChannelSummary = { id: string; name: string }

/**
 * Build the MCP server's `instructions` text. Claude reads this once at session
 * start to learn the event format and the autonomous troubleshooting loop.
 * Pure function — kept in its own file so updating prompt content does not
 * touch the server bootstrap.
 */
export const buildChannelServerInstructions = (
  allChannels: ChannelSummary[],
  currentChannelName: string | null,
): string => {
  const channelContext =
    allChannels.length > 0
      ? [
          "",
          "Configured channels (use as the `channel` argument to diagnostic tools):",
          ...allChannels.map(
            (ch) => `  ${ch.name}${ch.name === currentChannelName ? " ← this session" : ""}`,
          ),
        ].join("\n")
      : ""

  return [
    `Events arrive as notifications (method: notifications/claude/channel) with two fields:`,
    `  content — the event payload as a JSON string (parse it to read the message)`,
    `  meta    — key/value strings describing the event`,
    "",
    "meta fields by event_type:",
    "  slack:    event_type=slack  channel_id=C…  thread_ts=1234.5678  user_id=U…  mentioned=true|false",
    "  gh:       event_type=gh     repository=owner/repo  subject_type=Issue|PullRequest  subject_url=…  reason=…",
    "  discord:  event_type=discord  channel_id=…  user_id=…  guild_id=…  mentioned=true|false",
    "  schedule: event_type=schedule  entry_id=…",
    "",
    "To reply to a Slack message in the same thread, call the connector tool with:",
    `  method: POST`,
    `  path:   chat.postMessage`,
    `  body:   { channel: meta.channel_id, text: "your reply", thread_ts: meta.thread_ts }`,
    "",
    "To comment on a GitHub issue/PR (extract from subject_url in meta):",
    `  method: POST`,
    `  path:   repos/<meta.repository>/issues/<number>/comments`,
    `  body:   { body: "your reply" }`,
    "",
    "When anything seems off (events stopped, a tool failed), call fnl_doctor first:",
    "  fnl_doctor                  → diagnose all channels (read-only)",
    '  fnl_doctor { mode: "safe" } → diagnose + safely fix what can be fixed',
    '  fnl_doctor { mode: "aggressive" } → also restart the gateway if needed',
    "",
    "fnl_doctor returns { status, message, appliedActions, remainingIssues } —",
    "if status is 'ok' you are done; otherwise read remainingIssues for what is left.",
    "",
    "Other diagnostic tools you can call freely:",
    "  fnl_status                          gateway running state, listener health snapshot",
    "  fnl_debug                           per-channel diagnosis (subset of fnl_doctor)",
    "  fnl_recent_events                   last N processed events with outcome",
    "  fnl_dropped_events                  events filtered out (skip:*) with reason",
    "  fnl_raw_events                      raw inbound rows before any processing",
    "  fnl_connection_errors               listener auth-failed / error events",
    "  fnl_connection_timeline             full lifecycle (started/connected/disconnected/stopped)",
    "  fnl_logs                            tail of funnel.log (flume internal + structured app logs)",
    "  fnl_replay_event                    replay a past event to test a fix",
    "  fnl_docs                            embedded docs (architecture / debugging / recipes / …)",
    "",
    "Always prefer the built-in fnl_* tools over invoking the shell — they go directly to the",
    "gateway over loopback HTTP and return structured JSON.",
    channelContext,
  ].join("\n")
}
