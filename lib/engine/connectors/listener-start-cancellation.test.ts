import { expect, test } from "bun:test"
import { FunnelFlumeSlackListener } from "@/engine/connectors/slack-flume-listener"
import { FunnelFlumeDiscordListener } from "@/engine/connectors/discord-flume-listener"
import { FunnelFlumeGhListener } from "@/engine/connectors/gh-flume-listener"
import type { FunnelConnectorListener } from "@/engine/connectors/connector-listener"
import { MemoryFunnelHttpClient } from "@/engine/http/memory-http-client"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"

/** Capture the Flume boundary without opening external connections. */
class CapturingSlack extends FunnelFlumeSlackListener {
  startupSignal: AbortSignal | null = null
  protected override async runStart(options: { signal?: AbortSignal }): Promise<void> {
    this.startupSignal = options.signal ?? null
    options.signal?.throwIfAborted()
  }
}

class CapturingDiscord extends FunnelFlumeDiscordListener {
  startupSignal: AbortSignal | null = null
  protected override async runStart(options: { signal?: AbortSignal }): Promise<void> {
    this.startupSignal = options.signal ?? null
    options.signal?.throwIfAborted()
  }
}

class CapturingGh extends FunnelFlumeGhListener {
  startupSignal: AbortSignal | null = null
  protected override async runStart(options: { signal?: AbortSignal }): Promise<void> {
    this.startupSignal = options.signal ?? null
    options.signal?.throwIfAborted()
  }
}

const fixtures = [
  {
    name: "slack",
    create: (signal?: AbortSignal) =>
      new CapturingSlack({
        config: {
          id: "slack",
          name: "chat",
          type: "slack",
          botToken: "xoxb-example",
          appToken: "xapp-example",
          minify: true,
        },
        signal,
        http: new MemoryFunnelHttpClient().on(() => ({ body: '{"ok":true,"user_id":"example"}' })),
      }),
  },
  {
    name: "discord",
    create: (signal?: AbortSignal) =>
      new CapturingDiscord({
        config: { id: "discord", name: "chat", type: "discord", botToken: "example-token" },
        signal,
      }),
  },
  {
    name: "github",
    create: (signal?: AbortSignal) =>
      new CapturingGh({
        config: { id: "github", name: "code", type: "gh", token: "example-token" },
        signal,
      }),
  },
]

test.each(fixtures)(
  "$name refuses a cancelled registry start before opening Flume",
  async (fixture) => {
    const capture = fixture.create()
    const listener: FunnelConnectorListener = capture
    await expect(
      listener.start(async () => {}, AbortSignal.abort(new Error("start cancelled"))),
    ).rejects.toThrow("start cancelled")
    expect(capture.startupSignal).toBeNull()
  },
)

test.each(fixtures)(
  "$name forwards registry cancellation while preserving host cancellation",
  async (fixture) => {
    for (const cancelled of ["host", "registry"]) {
      const host = new AbortController()
      const registry = new AbortController()
      const capture = fixture.create(host.signal)
      const listener: FunnelConnectorListener = capture
      await listener.start(async () => {}, registry.signal)
      expect(capture.startupSignal?.aborted).toBe(false)
      if (cancelled === "host") host.abort()
      else registry.abort()
      expect(capture.startupSignal?.aborted).toBe(true)
    }
  },
)

test("Slack cancels auth.test before a late response can open a connection", async () => {
  const received = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const controller = new AbortController()
  const http = new MemoryFunnelHttpClient().on(async (request) => {
    received.resolve()
    await release.promise
    expect(request.signal?.aborted).toBe(true)
    return { body: '{"ok":true,"user_id":"example"}' }
  })
  const capture = new CapturingSlack({
    config: {
      id: "slack",
      name: "chat",
      type: "slack",
      botToken: "xoxb-example",
      appToken: "xapp-example",
      minify: true,
    },
    http,
  })
  const opening = capture.start(async () => {}, controller.signal)
  await received.promise
  controller.abort(new Error("startup cancelled"))
  release.resolve()
  await expect(opening).rejects.toThrow("startup cancelled")
  expect(capture.startupSignal).toBeNull()
})

test("registry stop cancels the built-in Slack authentication request", async () => {
  const received = Promise.withResolvers<void>()
  const reply = Promise.withResolvers<{ body: string }>()
  const http = new MemoryFunnelHttpClient().on((request) => {
    request.signal?.addEventListener("abort", () => reply.reject(request.signal?.reason), {
      once: true,
    })
    received.resolve()
    return reply.promise
  })
  const config = {
    id: "slack",
    name: "chat",
    type: "slack" as const,
    botToken: "xoxb-example",
    appToken: "xapp-example",
    minify: true,
  }
  const capture = new CapturingSlack({ config, http })
  const registry = new FunnelListenerRegistry({
    channels: {
      listAllConnectors: () => [{ ...config, channelId: "ops-id", channelName: "ops" }],
      createListener: () => ({ config, channelId: "ops-id", listener: capture }),
    },
    notify: async () => {},
  })
  const starting = registry.start("ops", "chat")
  try {
    await received.promise
    await registry.stop("ops", "chat")
    expect((await starting).ok).toBe(false)
    expect(http.calls[0]?.signal?.aborted).toBe(true)
    expect(capture.startupSignal).toBeNull()
    expect(registry.list()).toEqual([])
  } finally {
    reply.resolve({ body: '{"ok":true}' })
    await registry.stopAll()
  }
})
