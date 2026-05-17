export const usageHintForType = (type: string): string => {
  if (type === "slack") {
    return "Slack Web API. method=POST path=chat.postMessage body={channel,text,thread_ts?}"
  }

  if (type === "discord") {
    return "Discord REST API. method=POST path=/channels/<id>/messages body={content,...}"
  }

  if (type === "gh") {
    return "GitHub REST via gh CLI. method=POST path=repos/owner/repo/issues/N/comments body={body}"
  }

  return "Generic adapter call."
}
