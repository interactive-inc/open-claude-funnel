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
  const done = (): IteratorReturnResult<undefined> => ({ done: true, value: undefined })
  const pending = new Set<() => void>()
  let closed = false
  let closing: Promise<IteratorReturnResult<undefined>> | undefined
  const close = () => {
    closed = true
    for (const cancel of pending) cancel()
    pending.clear()
  }
  const finish = () => {
    close()
    if (closing) return closing
    // Install the cleanup guard before invoking host code, which may reenter.
    const completion = Promise.withResolvers<IteratorReturnResult<undefined>>()
    closing = completion.promise
    const cleanup = async () => {
      await iterator.return?.()
      return done()
    }
    void cleanup().then(completion.resolve, completion.reject)
    return closing
  }
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    async next() {
      if (closed) return done()
      const canceled = Promise.withResolvers<IteratorReturnResult<undefined>>()
      const cancel = () => canceled.resolve(done())
      pending.add(cancel)
      const read = async (): Promise<IteratorResult<AgentSdkInputMessage>> => {
        const item = await iterator.next()
        if (closed) return done()
        if (item.done) {
          close()
          return done()
        }
        return { done: false, value: agentSdkMessage(item.value) }
      }
      try {
        return await Promise.race([read(), canceled.promise])
      } catch (error) {
        // Cleanup must not replace or delay the original read/transform failure.
        void finish().catch(() => {})
        throw error
      } finally {
        pending.delete(cancel)
      }
    },
    return: finish,
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
