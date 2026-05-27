import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { FunnelSlackListener } from "@/connectors/slack-listener"
import type { SlackConnectorConfig } from "@/connectors/slack-connector-schema"
import type { SlackRawEvent } from "@/connectors/slack-event-processor"
import { MemoryConnectorDiagnosticLog } from "@/gateway/memory-connector-diagnostic-log"

const hoisted = {
  middlewareHandlers: [] as ((args: unknown) => Promise<void>)[],
  mockApp: null as MockApp | null,
  appConstructorCalls: 0,
  // When set, the next-constructed FakeApp's auth.test rejects with this.
  authError: null as Error | null,
}

type MockApp = {
  use: ReturnType<typeof mock>
  error: ReturnType<typeof mock>
  action: ReturnType<typeof mock>
  start: ReturnType<typeof mock>
  stop: ReturnType<typeof mock>
  client: {
    auth: { test: ReturnType<typeof mock> }
    reactions: { add: ReturnType<typeof mock> }
  }
}

mock.module("@slack/bolt", () => {
  class FakeApp {
    use: ReturnType<typeof mock>
    error: ReturnType<typeof mock>
    action: ReturnType<typeof mock>
    start: ReturnType<typeof mock>
    stop: ReturnType<typeof mock>
    client = {
      auth: {
        test: mock(() =>
          hoisted.authError
            ? Promise.reject(hoisted.authError)
            : Promise.resolve({ user_id: "U_BOT", bot_id: "B_BOT" }),
        ),
      },
      reactions: { add: mock(() => Promise.resolve({ ok: true })) },
    }

    constructor() {
      hoisted.appConstructorCalls += 1
      this.use = mock((handler: (args: unknown) => Promise<void>) => {
        hoisted.middlewareHandlers.push(handler)
      })
      this.error = mock(() => {})
      this.action = mock(() => {})
      this.start = mock(() => Promise.resolve(undefined))
      this.stop = mock(() => Promise.resolve(undefined))
      hoisted.mockApp = this as unknown as MockApp
    }
  }

  return {
    LogLevel: { ERROR: "ERROR" },
    App: FakeApp,
  }
})

const buildConfig = (): SlackConnectorConfig => ({
  id: "co-1",
  type: "slack",
  name: "test",
  botToken: "xoxb-test",
  appToken: "xapp-test",
  minify: true,
})

beforeEach(() => {
  hoisted.middlewareHandlers.length = 0
  hoisted.mockApp = null
  hoisted.appConstructorCalls = 0
  hoisted.authError = null
})

afterEach(() => {
  hoisted.middlewareHandlers.length = 0
  hoisted.mockApp = null
  hoisted.authError = null
})

describe("FunnelSlackListener.onAppCreated", () => {
  test("invokes onAppCreated after constructing the Bolt App, before app.start", async () => {
    const calls: { hasUse: boolean; startCalls: number }[] = []
    const listener = new FunnelSlackListener({
      config: buildConfig(),
      onAppCreated: (app) => {
        const mock = app as unknown as MockApp
        calls.push({
          hasUse: typeof mock.use === "function",
          startCalls: mock.start.mock.calls.length,
        })
      },
    })

    await listener.start(async () => {})

    expect(calls).toHaveLength(1)
    expect(calls[0]?.hasUse).toBe(true)
    expect(calls[0]?.startCalls).toBe(0)
    expect(hoisted.mockApp?.start.mock.calls.length).toBe(1)
  })

  test("supports async onAppCreated", async () => {
    let invoked = false
    const listener = new FunnelSlackListener({
      config: buildConfig(),
      onAppCreated: async () => {
        await new Promise((resolve) => setTimeout(resolve, 1))
        invoked = true
      },
    })

    await listener.start(async () => {})

    expect(invoked).toBe(true)
  })
})

describe("FunnelSlackListener.preprocessEvent", () => {
  test("drops the event when preprocessEvent returns null", async () => {
    const notify = mock(async () => {})
    const listener = new FunnelSlackListener({
      config: buildConfig(),
      preprocessEvent: () => null,
    })

    await listener.start(notify)

    expect(hoisted.middlewareHandlers).toHaveLength(1)
    await hoisted.middlewareHandlers[0]?.({
      event: {
        type: "message",
        channel: "C1",
        ts: "1.0",
        event_ts: "1.0",
        user: "U_REAL",
        text: "hello",
      },
    })

    expect(notify).not.toHaveBeenCalled()
  })

  test("forwards the transformed event to the processor", async () => {
    const notify = mock(async () => {})
    const captured: SlackRawEvent[] = []
    const listener = new FunnelSlackListener({
      config: buildConfig(),
      preprocessEvent: (event) => {
        captured.push(event)
        return { ...event, files: undefined }
      },
    })

    await listener.start(notify)

    await hoisted.middlewareHandlers[0]?.({
      event: {
        type: "message",
        channel: "C1",
        ts: "1.0",
        event_ts: "1.0",
        user: "U_REAL",
        text: "with images",
        files: [{ id: "F1" }],
      },
    })

    expect(captured).toHaveLength(1)
    expect(captured[0]?.files).toEqual([{ id: "F1" }])
    expect(notify).toHaveBeenCalledTimes(1)
    const passedContent = notify.mock.calls.at(0)?.at(0)
    expect(typeof passedContent).toBe("string")
    const parsedSent = JSON.parse(passedContent as unknown as string) as Record<string, unknown>
    expect(parsedSent.files).toBeUndefined()
  })

  test("passes the raw event through when no preprocessEvent is supplied", async () => {
    const notify = mock(async () => {})
    const listener = new FunnelSlackListener({
      config: buildConfig(),
    })

    await listener.start(notify)

    await hoisted.middlewareHandlers[0]?.({
      event: {
        type: "message",
        channel: "C1",
        ts: "1.0",
        event_ts: "1.0",
        user: "U_REAL",
        text: "hi",
      },
    })

    expect(notify).toHaveBeenCalledTimes(1)
  })

  test("adds the eyes reaction only after notify resolves", async () => {
    const order: string[] = []
    const notify = mock(async () => {
      order.push("notify")
    })
    const listener = new FunnelSlackListener({ config: buildConfig() })

    await listener.start(notify)
    hoisted.mockApp?.client.reactions.add.mockImplementation(async () => {
      order.push("reaction")
      return { ok: true }
    })

    await hoisted.middlewareHandlers[0]?.({
      event: {
        type: "message",
        channel: "C1",
        ts: "1.0",
        event_ts: "1.0",
        user: "U_REAL",
        text: "<@U_BOT> hi",
      },
    })

    expect(order).toEqual(["notify", "reaction"])
  })

  test("skips the eyes reaction when notify throws (undelivered is not marked seen)", async () => {
    const notify = mock(async () => {
      throw new Error("delivery failed")
    })
    const listener = new FunnelSlackListener({ config: buildConfig() })

    await listener.start(notify)

    await expect(
      hoisted.middlewareHandlers[0]?.({
        event: {
          type: "message",
          channel: "C1",
          ts: "1.0",
          event_ts: "1.0",
          user: "U_REAL",
          text: "<@U_BOT> hi",
        },
      }),
    ).rejects.toThrow("delivery failed")

    expect(notify).toHaveBeenCalledTimes(1)
    expect(hoisted.mockApp?.client.reactions.add).not.toHaveBeenCalled()
  })
})

describe("FunnelSlackListener: non-event payloads", () => {
  test("passes block_actions through to next() instead of swallowing it", async () => {
    // Regression: the global middleware used to `return` for payloads without
    // an `event` key, halting the chain so app.action handlers (approval
    // buttons) never fired. block_actions/view_submission/commands must pass
    // through to the listeners registered via onAppCreated.
    const notify = mock(async () => {})
    const listener = new FunnelSlackListener({ config: buildConfig() })

    await listener.start(notify)

    const next = mock(async () => {})
    await hoisted.middlewareHandlers[0]?.({
      body: { type: "block_actions", actions: [{ action_id: "approve" }] },
      next,
    })

    expect(next).toHaveBeenCalledTimes(1)
    expect(notify).not.toHaveBeenCalled()
  })

  test("consumes events without calling next() (funnel is the sole event sink)", async () => {
    const notify = mock(async () => {})
    const listener = new FunnelSlackListener({ config: buildConfig() })

    await listener.start(notify)

    const next = mock(async () => {})
    await hoisted.middlewareHandlers[0]?.({
      event: {
        type: "message",
        channel: "C1",
        ts: "1.0",
        event_ts: "1.0",
        user: "U_REAL",
        text: "hi",
      },
      next,
    })

    expect(notify).toHaveBeenCalledTimes(1)
    expect(next).not.toHaveBeenCalled()
  })
})

describe("FunnelSlackListener: backwards compatibility", () => {
  test("constructor works without any hooks (no onAppCreated, no preprocessEvent)", async () => {
    const listener = new FunnelSlackListener({ config: buildConfig() })

    await listener.start(async () => {})

    expect(hoisted.appConstructorCalls).toBe(1)
    expect(hoisted.mockApp?.start.mock.calls.length).toBe(1)
  })

  test("records nothing when no diagnosticLog is injected (no-op)", async () => {
    const listener = new FunnelSlackListener({ config: buildConfig() })

    await listener.start(async () => {})

    // Just exercising the path; absence of a throw is the assertion.
    await hoisted.middlewareHandlers[0]?.({
      event: { type: "message", channel: "C1", ts: "1.0", event_ts: "1.0", user: "U_REAL", text: "hi" },
    })
  })
})

describe("FunnelSlackListener: diagnostic log", () => {
  test("records a raw row and an emitted processed row for a delivered event", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelSlackListener({
      config: buildConfig(),
      channelId: "ch-uuid-1",
      diagnosticLog,
    })

    await listener.start(async () => {})
    await hoisted.middlewareHandlers[0]?.({
      event: { type: "message", channel: "C1", ts: "1.0", event_ts: "1.0", user: "U_REAL", text: "hi" },
    })

    const raws = diagnosticLog.queryRaw({})
    expect(raws).toHaveLength(1)
    expect(raws[0]?.type).toBe("slack")
    expect(raws[0]?.connectorId).toBe("co-1")
    expect(raws[0]?.channelId).toBe("ch-uuid-1")
    expect(JSON.parse(raws[0]?.payload ?? "").channel).toBe("C1")

    const processed = diagnosticLog.queryProcessed({})
    expect(processed).toHaveLength(1)
    expect(processed[0]?.outcome).toBe("emitted")
    // The raw row and its processed verdict carry the same correlation id.
    expect(processed[0]?.eventId).toBe(raws[0]?.eventId ?? "")
  })

  test("records the raw event but a skip outcome when the processor drops it", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelSlackListener({ config: buildConfig(), diagnosticLog })

    await listener.start(async () => {})
    // reaction_added is not in ALLOWED_EVENTS — dropped at the type gate.
    await hoisted.middlewareHandlers[0]?.({
      event: { type: "reaction_added", channel: "C1", ts: "1.0", event_ts: "1.0", user: "U_REAL" },
    })

    // The raw event is still captured even though no notification fired.
    expect(diagnosticLog.queryRaw({})).toHaveLength(1)
    expect(diagnosticLog.queryProcessed({ outcome: "skip:type" })).toHaveLength(1)
  })

  test("records a dedup skip on the second identical event", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelSlackListener({ config: buildConfig(), diagnosticLog })
    const event = {
      event: { type: "message", channel: "C1", ts: "1.0", event_ts: "1.0", user: "U_REAL", text: "hi" },
    }

    await listener.start(async () => {})
    await hoisted.middlewareHandlers[0]?.(event)
    await hoisted.middlewareHandlers[0]?.(event)

    expect(diagnosticLog.queryRaw({})).toHaveLength(2)
    expect(diagnosticLog.queryProcessed({ outcome: "emitted" })).toHaveLength(1)
    expect(diagnosticLog.queryProcessed({ outcome: "skip:dedup" })).toHaveLength(1)
  })

  test("records emitted:delivery-failed (not emitted) when notify throws", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const notify = mock(async () => {
      throw new Error("delivery failed")
    })
    const listener = new FunnelSlackListener({ config: buildConfig(), diagnosticLog })

    await listener.start(notify)
    await expect(
      hoisted.middlewareHandlers[0]?.({
        event: { type: "message", channel: "C1", ts: "1.0", event_ts: "1.0", user: "U_REAL", text: "hi" },
      }),
    ).rejects.toThrow("delivery failed")

    // The verdict reflects the failed delivery, not a false "emitted".
    expect(diagnosticLog.queryProcessed({ outcome: "emitted" })).toHaveLength(0)
    expect(diagnosticLog.queryProcessed({ outcome: "emitted:delivery-failed" })).toHaveLength(1)
  })

  test("records a preprocess skip when preprocessEvent drops the event", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelSlackListener({
      config: buildConfig(),
      diagnosticLog,
      preprocessEvent: () => null,
    })

    await listener.start(async () => {})
    await hoisted.middlewareHandlers[0]?.({
      event: { type: "message", channel: "C1", ts: "1.0", event_ts: "1.0", user: "U_REAL", text: "hi" },
    })

    // Raw is captured before preprocessing, so it survives the drop.
    expect(diagnosticLog.queryRaw({})).toHaveLength(1)
    expect(diagnosticLog.queryProcessed({ outcome: "skip:preprocess" })).toHaveLength(1)
  })
})

describe("FunnelSlackListener: connection lifecycle", () => {
  test("records started then connected on a successful start", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelSlackListener({ config: buildConfig(), diagnosticLog })

    await listener.start(async () => {})

    const statuses = diagnosticLog.queryConnection({}).map((row) => row.status)
    expect(statuses).toContain("started")
    expect(statuses).toContain("connected")
  })

  test("records auth-failed (not connected) when auth.test throws", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelSlackListener({ config: buildConfig(), diagnosticLog })

    // Make the next app's auth.test reject (bad/expired token).
    hoisted.authError = new Error("invalid_auth")

    await expect(listener.start(async () => {})).rejects.toThrow("invalid_auth")

    const statuses = diagnosticLog.queryConnection({}).map((row) => row.status)
    expect(statuses).toContain("auth-failed")
    expect(statuses).not.toContain("connected")
    expect(diagnosticLog.queryConnection({ status: "auth-failed" })[0]?.detail).toBe("invalid_auth")
  })

  test("records disconnected then stopped on stop()", async () => {
    const diagnosticLog = new MemoryConnectorDiagnosticLog()
    const listener = new FunnelSlackListener({ config: buildConfig(), diagnosticLog })

    await listener.start(async () => {})
    await listener.stop()

    const statuses = diagnosticLog.queryConnection({}).map((row) => row.status)
    expect(statuses).toContain("disconnected")
    expect(statuses).toContain("stopped")
  })
})
