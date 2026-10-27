import type { ReplayableEvent } from "@/gateway/broadcaster"

/** Structural SDK input, without importing or controlling an Agent SDK instance. */
export type AgentSdkInputMessage = {
  type: "user"
  message: { role: "user"; content: string }
  parent_tool_use_id: null
  session_id: string
}

/** Preserve routing context as JSON data; session settings and response handling belong to the host. */
export function agentSdkMessage(event: ReplayableEvent): AgentSdkInputMessage {
  return {
    type: "user",
    message: {
      role: "user",
      content: JSON.stringify({ content: event.content, meta: event.meta, offset: event.offset }),
    },
    parent_tool_use_id: null,
    session_id: "",
  }
}

/** Pass directly as query({ prompt }) or Query.streamInput(...). No SDK wrapper. */
export function agentSdkInput(
  events: AsyncIterable<ReplayableEvent>,
): AsyncIterableIterator<AgentSdkInputMessage> {
  const iterator = events[Symbol.asyncIterator]()
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      const item = await iterator.next()
      return item.done
        ? { done: true, value: undefined }
        : { done: false, value: agentSdkMessage(item.value) }
    },
    async return() {
      await iterator.return?.()
      return { done: true, value: undefined }
    },
  }
}

/** Merge into the capabilities of a host-owned MCP Server. */
export const claudeChannelCapabilities = Object.freeze({
  experimental: Object.freeze({ "claude/channel": Object.freeze({}) }),
})

export type ClaudeChannelNotification = {
  method: "notifications/claude/channel"
  params: { content: string; meta: Record<string, string> }
}

/** Pass to Server.notification(). Only Claude-supported attribute keys are forwarded. */
export function claudeChannelNotification(event: ReplayableEvent): ClaudeChannelNotification {
  const meta = Object.fromEntries(
    Object.entries(event.meta ?? {}).filter(([key]) => /^[A-Za-z0-9_]+$/.test(key)),
  )
  meta.funnel_offset = String(event.offset)
  return { method: "notifications/claude/channel", params: { content: event.content, meta } }
}
