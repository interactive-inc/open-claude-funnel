import { expect, test } from "bun:test"
import { getEventListeners } from "node:events"
import { FunnelChannelSupervisor } from "@/engine/channel/channel-supervisor"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

const options = () => ({
  broadcaster: { broadcast() {} },
  logger: new MemoryFunnelLogger(),
  clock: new MemoryFunnelClock(),
})

test("manual shutdown detaches the host abort handler and shares one stop promise", async () => {
  const host = new AbortController()
  const supervisor = new FunnelChannelSupervisor({ ...options(), signal: host.signal })
  try {
    expect(getEventListeners(host.signal, "abort")).toHaveLength(1)
    const stopping = supervisor.stop()
    expect(supervisor.stop()).toBe(stopping)
    await stopping
    expect(getEventListeners(host.signal, "abort")).toEqual([])
  } finally {
    host.abort()
    await supervisor.stop()
  }
})

test("an already aborted host does not retain an inert supervisor callback", async () => {
  const host = new AbortController()
  host.abort()
  const supervisor = new FunnelChannelSupervisor({ ...options(), signal: host.signal })
  try {
    expect(getEventListeners(host.signal, "abort")).toEqual([])
  } finally {
    await supervisor.stop()
  }
})

test("the host signal is captured once for admission and shutdown cleanup", async () => {
  const host = new AbortController()
  const other = new AbortController()
  other.abort()
  let reads = 0
  const supervisor = new FunnelChannelSupervisor({
    ...options(),
    get signal() {
      return ++reads === 1 ? host.signal : other.signal
    },
  })
  try {
    supervisor.register({ id: "source", build: () => ({ sources: [] }) })
    expect(supervisor.has("source")).toBe(true)
    await supervisor.stop()
    expect(reads).toBe(1)
    expect(getEventListeners(host.signal, "abort")).toEqual([])
  } finally {
    host.abort()
    await supervisor.stop()
  }
})

test("shutdown reentry from an opening channel shares the published completion", async () => {
  const host = new AbortController()
  const supervisor = new FunnelChannelSupervisor({ ...options(), signal: host.signal })
  const entered = Promise.withResolvers<void>()
  const released = Promise.withResolvers<{ sources: [] }>()
  let nested: Promise<void> | undefined
  supervisor.register({
    id: "source",
    build(ctx) {
      entered.resolve()
      ctx.signal.addEventListener(
        "abort",
        () => {
          nested = supervisor.stop()
          released.resolve({ sources: [] })
        },
        { once: true },
      )
      return released.promise
    },
  })
  const starting = supervisor.start()
  try {
    await entered.promise
    const stopping = supervisor.stop()
    expect(nested).toBe(stopping)
    await stopping
    await starting
    expect(supervisor.ids()).toEqual([])
    expect(getEventListeners(host.signal, "abort")).toEqual([])
  } finally {
    released.resolve({ sources: [] })
    await supervisor.stop()
    await starting
  }
})
