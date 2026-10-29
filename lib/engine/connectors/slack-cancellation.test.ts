import { expect, test } from "bun:test"
import {
  FunnelFlumeSlackListener,
  type SlackPreprocessEvent,
} from "@/engine/connectors/slack-flume-listener"
import { MemoryFunnelHttpClient, type MemoryHttpHandler } from "@/engine/http/memory-http-client"
import { MemoryConnectorDiagnosticLog } from "@/engine/diagnostic-log/memory-diagnostic-log"
import type { FlumeRuntimeDeps } from "@interactive-inc/flume"
import type { NotifyFn } from "@/engine/connectors/connector-listener"
import type { HttpRequest } from "@/engine/http/http-client"

type SocketEvent = { data?: string; code?: number; reason?: string }
type Handler = (event: SocketEvent) => void
class Socket {
  static instances: Socket[] = []
  static OPEN = 1
  static CLOSED = 3
  readyState = 1
  private handlers = new Map<string, Set<Handler>>()
  constructor() {
    Socket.instances.push(this)
    setTimeout(() => this.emit({ type: "hello" }), 0)
  }
  addEventListener(type: string, handler: Handler): void {
    const set = this.handlers.get(type) ?? new Set()
    set.add(handler)
    this.handlers.set(type, set)
  }
  removeEventListener(type: string, handler: Handler): void {
    this.handlers.get(type)?.delete(handler)
  }
  send(): void {}
  close(): void {
    this.readyState = 3
    for (const handler of this.handlers.get("close") ?? []) handler({ code: 1000, reason: "" })
  }
  emit(frame: Record<string, unknown>): void {
    for (const handler of this.handlers.get("message") ?? [])
      handler({ data: JSON.stringify(frame) })
  }
}

type Options = {
  preprocessEvent?: SlackPreprocessEvent
  notify: NotifyFn
  reaction?: MemoryHttpHandler
  auth?: MemoryHttpHandler
}
const createContext = (options: Options) => {
  const host = new AbortController()
  const ownership = new AbortController()
  const log = new MemoryConnectorDiagnosticLog()
  const http = new MemoryFunnelHttpClient().on((request) => {
    if (request.url.endsWith("auth.test"))
      return (
        options.auth?.(request) ?? {
          body: JSON.stringify({ ok: true, user_id: "BOT", bot_id: "BOT_ID" }),
        }
      )
    return options.reaction?.(request) ?? { body: JSON.stringify({ ok: true }) }
  })
  const listener = new FunnelFlumeSlackListener({
    config: {
      id: "source",
      type: "slack",
      name: "events",
      botToken: "xoxb-example",
      appToken: "xapp-example",
      minify: true,
    },
    signal: host.signal,
    http,
    diagnosticLog: log,
    preprocessEvent: options.preprocessEvent,
    flumeDeps: {
      // The source only uses the transport methods exercised by this typed IO fixture.
      WebSocket: Socket as unknown as FlumeRuntimeDeps["WebSocket"],
      fetch: async () => Response.json({ ok: true, url: "wss://socket.example" }),
    },
  })
  let eventNumber = 0
  const emit = (text: string) =>
    Socket.instances.at(-1)!.emit({
      type: "events_api",
      envelope_id: String(++eventNumber),
      payload: {
        event: { type: "message", user: "USER", channel: "C1", ts: String(eventNumber), text },
      },
    })
  return { listener, http, log, emit, host, ownership }
}
const setup = async (options: Options) => {
  const context = createContext(options)
  await context.listener.start(options.notify, context.ownership.signal)
  return context
}
const cancel = async (
  context: ReturnType<typeof createContext>,
  owner: "host" | "ownership" | "direct",
) => {
  if (owner === "direct") await context.listener.stop()
  else context[owner].abort()
}

for (const owner of ["host", "ownership", "direct"] as const) {
  test(`${owner} cancellation prevents delayed preprocessing from delivering new input`, async () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let delivered = 0
    const context = await setup({
      preprocessEvent: async (event) => {
        entered.resolve()
        await release.promise
        return event
      },
      notify: async () => {
        delivered++
      },
    })
    try {
      context.emit("input")
      await entered.promise
      await cancel(context, owner)
      release.resolve()
      await Bun.sleep(0)
      expect(delivered).toBe(0)
    } finally {
      release.resolve()
      await context.listener.stop()
    }
  })

  test(`${owner} cancellation during notify prevents a new cosmetic reaction`, async () => {
    const notified = Promise.withResolvers<void>()
    const context = await setup({
      notify: async () => {
        await cancel(context, owner)
        await context.listener.stop()
        notified.resolve()
      },
    })
    try {
      context.emit("hello <@BOT>")
      await notified.promise
      await Bun.sleep(0)
      expect(context.http.calls.filter((request) => request.url.endsWith("reactions.add"))).toEqual(
        [],
      )
    } finally {
      await context.listener.stop()
    }
  })

  test(`${owner} cancellation reaches a pending reaction and is not reported as an API failure`, async () => {
    const requested = Promise.withResolvers<HttpRequest>()
    const response = Promise.withResolvers<{ body: string }>()
    const context = await setup({
      notify: async () => {},
      reaction: async (request) => {
        requested.resolve(request)
        return response.promise
      },
    })
    try {
      context.emit("hello <@BOT>")
      const request = await requested.promise
      await cancel(context, owner)
      expect(request.signal?.aborted).toBe(true)
      response.resolve({ body: JSON.stringify({ ok: false, error: "canceled response" }) })
      await Bun.sleep(0)
      expect(context.log.queryProcessed({ outcome: "emitted:reaction-failed" })).toEqual([])
    } finally {
      response.resolve({ body: JSON.stringify({ ok: true }) })
      await context.listener.stop()
    }
  })
}

test("direct stop cancels pending authentication and cannot reopen a late connection", async () => {
  const requested = Promise.withResolvers<HttpRequest>()
  const response = Promise.withResolvers<{ body: string }>()
  const authenticated = { body: JSON.stringify({ ok: true, user_id: "BOT", bot_id: "BOT_ID" }) }
  let authCalls = 0
  const context = createContext({
    notify: async () => {},
    auth: async (request) => {
      if (++authCalls > 1) return authenticated
      requested.resolve(request)
      return response.promise
    },
  })
  const socketsBefore = Socket.instances.length
  const startup = context.listener
    .start(async () => {}, context.ownership.signal)
    .then(
      () => null,
      (error: unknown) => error,
    )
  try {
    const request = await requested.promise
    await context.listener.stop()
    expect(request.signal?.aborted).toBe(true)
    expect(Socket.instances).toHaveLength(socketsBefore)
    await context.listener.start(async () => {}, context.ownership.signal)
    response.resolve(authenticated)
    expect(await startup).toMatchObject({ name: "AbortError" })
    expect(context.listener.isAlive()).toBe(true)
    expect(Socket.instances).toHaveLength(socketsBefore + 1)
  } finally {
    response.resolve({ body: JSON.stringify({ ok: true }) })
    await startup
    await context.listener.stop()
  }
})

test("a duplicate Slack start cannot open another source or stop the active one", async () => {
  const context = await setup({ notify: async () => {} })
  const sockets = Socket.instances.length
  try {
    await expect(context.listener.start(async () => {}, context.ownership.signal)).rejects.toThrow(
      "already starting or running",
    )
    expect(Socket.instances).toHaveLength(sockets)
    expect(context.listener.isAlive()).toBe(true)
  } finally {
    await context.listener.stop()
  }
})

test("preprocessing from an old Slack lifecycle cannot deliver into a restarted source", async () => {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  let oldDelivered = 0
  let newDelivered = 0
  let first = true
  const context = await setup({
    notify: async () => {
      oldDelivered++
    },
    preprocessEvent: async (event) => {
      if (first) {
        first = false
        entered.resolve()
        await release.promise
      }
      return event
    },
  })
  try {
    context.emit("old input")
    await entered.promise
    await context.listener.stop()
    await context.listener.start(async () => {
      newDelivered++
    }, context.ownership.signal)
    release.resolve()
    await Bun.sleep(0)
    expect(oldDelivered).toBe(0)
    expect(newDelivered).toBe(0)
    context.emit("new input")
    await Bun.sleep(0)
    expect(newDelivered).toBe(1)
  } finally {
    release.resolve()
    await context.listener.stop()
  }
})
