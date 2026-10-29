import { expect, test } from "bun:test"
import { FunnelFlumeDiscordListener } from "@/engine/connectors/discord-flume-listener"
import { FunnelFlumeGhListener } from "@/engine/connectors/gh-flume-listener"

test("GitHub stop during token resolution prevents a late poller from opening", async () => {
  let requests = 0
  const listener = new FunnelFlumeGhListener({
    config: { id: "source", name: "source", type: "gh", token: "example-token" },
    flumeDeps: {
      fetch: async () => {
        requests++
        return new Response("[]", { headers: { "content-type": "application/json" } })
      },
    },
  })
  const starting = listener
    .start(async () => {})
    .then(
      () => null,
      (error: unknown) => error,
    )
  try {
    await listener.stop()
    expect(await starting).toMatchObject({ name: "AbortError" })
    expect(requests).toBe(0)
    expect(listener.isAlive()).toBe(false)
  } finally {
    await starting
    await listener.stop()
  }
})

for (const type of ["discord", "gh"] as const) {
  const build = () => {
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    let signal: AbortSignal | undefined
    let opens = 0
    const capture = async (options: { signal?: AbortSignal }) => {
      opens++
      signal = options.signal
      entered.resolve()
      await release.promise
      options.signal?.throwIfAborted()
    }
    class Discord extends FunnelFlumeDiscordListener {
      protected override runStart(options: { signal?: AbortSignal }) {
        return capture(options)
      }
    }
    class Gh extends FunnelFlumeGhListener {
      protected override runStart(options: { signal?: AbortSignal }) {
        return capture(options)
      }
    }
    const listener =
      type === "discord"
        ? new Discord({
            config: { id: "source", name: "source", type: "discord", botToken: "example-token" },
          })
        : new Gh({ config: { id: "source", name: "source", type: "gh", token: "example-token" } })
    return { listener, entered, release, signal: () => signal, opens: () => opens }
  }

  test(`${type} direct stop cancels an in-flight start`, async () => {
    const run = build()
    const starting = run.listener.start(async () => {})
    try {
      await run.entered.promise
      await run.listener.stop()
      expect(run.signal()?.aborted).toBe(true)
      run.release.resolve()
      await expect(starting).rejects.toMatchObject({ name: "AbortError" })
    } finally {
      run.release.resolve()
      await starting.catch(() => {})
      await run.listener.stop()
    }
  })

  test(`${type} duplicate starts cannot open a second source`, async () => {
    const run = build()
    const starting = run.listener.start(async () => {})
    try {
      await run.entered.promise
      const duplicate = run.listener.start(async () => {})
      run.release.resolve()
      await starting
      await expect(duplicate).rejects.toThrow("already starting or running")
      expect(run.opens()).toBe(1)
    } finally {
      run.release.resolve()
      await starting.catch(() => {})
      await run.listener.stop()
    }
  })

  test(`${type} a canceled startup's late failure cannot stop its replacement`, async () => {
    const run = build()
    const first = run.listener.start(async () => {})
    let replacement: Promise<void> | undefined
    try {
      await run.entered.promise
      await run.listener.stop()
      replacement = run.listener.start(async () => {})
      run.release.resolve()
      await expect(first).rejects.toMatchObject({ name: "AbortError" })
      await replacement
      expect(run.opens()).toBe(2)
      expect(run.signal()?.aborted).toBe(false)
      await run.listener.stop()
      expect(run.signal()?.aborted).toBe(true)
    } finally {
      run.release.resolve()
      await Promise.allSettled([first, replacement])
      await run.listener.stop()
    }
  })
}
