import { describe, expect, mock, test } from "bun:test"
import { FunnelChannelSubscriber } from "@/engine/mcp/channel-subscriber"

const message = (offset: number): MessageEvent =>
  new MessageEvent("message", {
    data: JSON.stringify({
      content: `event-${offset}`,
      meta: { event_type: "test" },
      offset,
    }),
  })

const callPrivate = async (
  subscriber: FunnelChannelSubscriber,
  methodName: string,
  event: MessageEvent,
  socket?: { close(): void },
): Promise<void> => {
  const method = Reflect.get(subscriber, methodName)

  if (typeof method !== "function") throw new Error(`missing method: ${methodName}`)

  await method.call(subscriber, event, socket)
}

const lastOffsetOf = (subscriber: FunnelChannelSubscriber): unknown => {
  const state = Reflect.get(subscriber, "state")

  if (!state || typeof state !== "object" || !("lastOffset" in state)) {
    throw new Error("subscriber state is unavailable")
  }

  return state.lastOffset
}

describe("FunnelChannelSubscriber", () => {
  test("advances the replay offset only after the MCP notification succeeds", async () => {
    const notification = mock(async () => {
      throw new Error("transport failed")
    })
    const subscriber = new FunnelChannelSubscriber({
      // @ts-expect-error Narrow test double; no other Server methods are used by handleMessage.
      server: { notification },
      baseUrl: "ws://localhost/ws?channel=test",
      protocols: undefined,
    })

    await callPrivate(subscriber, "handleMessage", message(7))

    expect(notification).toHaveBeenCalledTimes(1)
    expect(lastOffsetOf(subscriber)).toBe(0)
  })

  test("serializes notifications before acknowledging later offsets", async () => {
    const gate: { resolve: (() => void) | null } = { resolve: null }
    const first = new Promise<void>((resolve) => {
      gate.resolve = resolve
    })
    const delivered: string[] = []
    const notification = mock(async (input: { params: { content: string } }) => {
      delivered.push(input.params.content)
      if (input.params.content === "event-1") await first
    })
    const subscriber = new FunnelChannelSubscriber({
      // @ts-expect-error Narrow test double; no other Server methods are used by handleMessage.
      server: { notification },
      baseUrl: "ws://localhost/ws?channel=test",
      protocols: undefined,
    })

    await callPrivate(subscriber, "enqueueMessage", message(1))
    await callPrivate(subscriber, "enqueueMessage", message(2))
    await Promise.resolve()

    expect(delivered).toEqual(["event-1"])
    expect(lastOffsetOf(subscriber)).toBe(0)

    gate.resolve?.()

    const state = Reflect.get(subscriber, "state")

    if (!state || typeof state !== "object" || !("messageQueue" in state)) {
      throw new Error("subscriber queue is unavailable")
    }

    await state.messageQueue

    expect(delivered).toEqual(["event-1", "event-2"])
    expect(lastOffsetOf(subscriber)).toBe(2)
  })

  test("stops at a failed notification so a later offset cannot hide the gap", async () => {
    const notification = mock(async (input: { params: { content: string } }) => {
      if (input.params.content === "event-1") throw new Error("transport failed")
    })
    const close = mock(() => {})
    const subscriber = new FunnelChannelSubscriber({
      // @ts-expect-error Narrow test double; no other Server methods are used by handleMessage.
      server: { notification },
      baseUrl: "ws://localhost/ws?channel=test",
      protocols: undefined,
    })

    await callPrivate(subscriber, "enqueueMessage", message(1), { close })
    await callPrivate(subscriber, "enqueueMessage", message(2), { close })

    const state = Reflect.get(subscriber, "state")

    if (!state || typeof state !== "object" || !("messageQueue" in state)) {
      throw new Error("subscriber queue is unavailable")
    }

    await state.messageQueue

    expect(notification).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect(lastOffsetOf(subscriber)).toBe(0)
  })
})
