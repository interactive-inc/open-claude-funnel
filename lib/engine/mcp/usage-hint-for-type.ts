export const usageHintForType = (type: string): string => {
  if (type === "slack") {
    return [
      "Slack Web API.",
      'To reply in the same thread: method=POST path=chat.postMessage body={ channel: meta.channel_id, text: "...", thread_ts: meta.thread_ts }',
      'To react: method=POST path=reactions.add body={ channel: meta.channel_id, timestamp: meta.thread_ts, name: "thumbsup" }',
      "Use meta fields from the incoming event: channel_id (Slack channel), thread_ts (thread anchor), user_id (sender).",
    ].join(" ")
  }

  if (type === "discord") {
    return [
      "Discord REST API.",
      'To reply: method=POST path=/channels/<meta.channel_id>/messages body={ content: "..." }',
      "Use meta fields: channel_id (Discord channel), user_id (sender), guild_id.",
    ].join(" ")
  }

  if (type === "gh") {
    return [
      "GitHub REST via gh CLI.",
      'To comment: method=POST path=repos/<meta.repository>/issues/<number>/comments body={ body: "..." }',
      "Parse <number> from meta.subject_url. meta fields: repository (owner/repo), subject_type, subject_url, reason.",
    ].join(" ")
  }

  return "Generic adapter call."
}
