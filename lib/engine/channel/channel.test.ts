import { expect, test } from "bun:test"
import {
  defineChannel,
  type ChannelBuildContext,
  type ChannelRuntime,
} from "@/engine/channel/channel"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

const context: ChannelBuildContext = {
  channelId: "source",
  channelName: "Source",
  signal: new AbortController().signal,
  logger: new MemoryFunnelLogger(),
  clock: new MemoryFunnelClock(),
}

test("defineChannel captures prototype properties and preserves private factory state", async () => {
  class Manifest {
    #builds = 0
    get id() {
      return "source"
    }
    get name() {
      return "Source"
    }
    build(ctx: ChannelBuildContext) {
      expect(ctx).toBe(context)
      this.#builds++
      return { sources: [] }
    }
    get builds() {
      return this.#builds
    }
  }
  const original = new Manifest()
  const channel = defineChannel(original)
  expect(channel.id).toBe("source")
  expect(channel.name).toBe("Source")
  expect(Object.isFrozen(channel)).toBe(true)
  expect(Object.isFrozen(original)).toBe(false)
  await channel.build(context)
  expect(original.builds).toBe(1)
})

test("defineChannel retains the initial identity and factory without freezing host state", async () => {
  const original = {
    id: "source",
    name: "Source",
    builds: 0,
    build(_ctx: ChannelBuildContext) {
      this.builds++
      return { sources: [] }
    },
  }
  const channel = defineChannel(original)
  original.id = "changed"
  original.name = "Changed"
  original.build = () => {
    throw new Error("replacement must not run")
  }
  await channel.build(context)
  expect(channel.id).toBe("source")
  expect(channel.name).toBe("Source")
  expect(original.builds).toBe(1)
})

test("defineChannel preserves an async factory's promise and failure", async () => {
  const completion = Promise.withResolvers<ChannelRuntime>()
  const original = { id: "source", build: () => completion.promise }
  const channel = defineChannel(original)
  const pending = channel.build(context)
  expect(pending).toBe(completion.promise)
  const failure = new Error("build failed")
  completion.reject(failure)
  await expect(pending).rejects.toBe(failure)
})
