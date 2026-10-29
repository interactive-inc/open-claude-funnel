import { expect, test } from "bun:test"
import { FunnelChannelSupervisor } from "@/engine/channel/channel-supervisor"
import type { ChannelBuildContext } from "@/engine/channel/channel"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"

const create = () =>
  new FunnelChannelSupervisor({
    broadcaster: { broadcast() {} },
    logger: new MemoryFunnelLogger(),
    clock: new MemoryFunnelClock(),
  })

for (const started of [false, true]) {
  test(`unregistering an absent ID cannot remove a later registration (started=${started})`, async () => {
    const supervisor = create()
    let builds = 0
    try {
      if (started) await supervisor.start()
      const pending = supervisor.unregister("source")
      supervisor.register({
        id: "source",
        build() {
          builds++
          return { sources: [] }
        },
      })
      await pending
      expect(supervisor.has("source")).toBe(true)
      if (!started) await supervisor.start()
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(builds).toBe(1)
      expect(supervisor.ids()).toContain("source")
      await supervisor.unregister("source")
      expect(supervisor.has("source")).toBe(false)
      expect(supervisor.ids()).not.toContain("source")
    } finally {
      await supervisor.stop()
    }
  })
}

test("registered manifest identity and factory survive caller mutation", async () => {
  const supervisor = create()
  const contexts: string[][] = []
  const manifest = {
    id: "original",
    name: "Original",
    build(ctx: ChannelBuildContext) {
      contexts.push([ctx.channelId, ctx.channelName])
      return { sources: [] }
    },
  }
  supervisor.register(manifest)
  manifest.id = "changed"
  manifest.name = "Changed"
  manifest.build = () => {
    throw new Error("replacement factory must not run")
  }
  try {
    await supervisor.start()
    expect(contexts).toEqual([["original", "Original"]])
    expect(supervisor.ids()).toContain("original")
    expect(supervisor.has("changed")).toBe(false)
    await supervisor.unregister("original")
    expect(supervisor.has("original")).toBe(false)
  } finally {
    await supervisor.stop()
  }
})

test("identity mutation inside a failed build cannot retain the original registration", async () => {
  const supervisor = create()
  const manifest = {
    id: "original",
    build() {
      manifest.id = "changed"
      throw new Error("build failed")
    },
  }
  supervisor.register(manifest)
  try {
    await supervisor.start()
    expect(supervisor.has("original")).toBe(false)
  } finally {
    await supervisor.stop()
  }
})

test("captured factories retain the original class receiver", async () => {
  class Manifest {
    readonly id = "source"
    #builds = 0
    build() {
      this.#builds++
      return { sources: [] }
    }
    get builds() {
      return this.#builds
    }
  }
  const manifest = new Manifest()
  const supervisor = create()
  supervisor.register(manifest)
  try {
    await supervisor.start()
    expect(manifest.builds).toBe(1)
    expect(supervisor.ids()).toContain("source")
  } finally {
    await supervisor.stop()
  }
})

test("the registration ID getter is read once", async () => {
  const supervisor = create()
  let reads = 0
  const seen: string[] = []
  supervisor.register({
    get id() {
      return ++reads === 1 ? "original" : "changed"
    },
    build(ctx) {
      seen.push(ctx.channelId)
      return { sources: [] }
    },
  })
  try {
    await supervisor.start()
    expect(reads).toBe(1)
    expect(seen).toEqual(["original"])
  } finally {
    await supervisor.stop()
  }
})

for (const field of ["id", "name", "build"] as const) {
  test(`shutdown from the manifest ${field} getter cannot retain or build a registration`, async () => {
    const supervisor = create()
    let builds = 0
    const values = {
      id: "source",
      name: "Source",
      build: () => {
        builds++
        return { sources: [] }
      },
    }
    const manifest = { ...values }
    Object.defineProperty(manifest, field, {
      get() {
        void supervisor.stop()
        return values[field]
      },
    })
    try {
      await supervisor.start()
      supervisor.register(manifest)
      await new Promise((resolve) => setTimeout(resolve, 0))
      await supervisor.stop()
      expect(supervisor.has("source")).toBe(false)
      expect(builds).toBe(0)
    } finally {
      await supervisor.stop()
    }
  })
}

test("registration reentry from a manifest getter cannot overwrite the admitted channel", async () => {
  const supervisor = create()
  const builds: string[] = []
  const nested = {
    id: "source",
    build() {
      builds.push("nested")
      return { sources: [] }
    },
  }
  try {
    expect(() =>
      supervisor.register({
        id: "source",
        get name() {
          supervisor.register(nested)
          return "Outer"
        },
        build() {
          builds.push("outer")
          return { sources: [] }
        },
      }),
    ).toThrow("already registered")
    await supervisor.start()
    expect(builds).toEqual(["nested"])
    expect(supervisor.has("source")).toBe(true)
  } finally {
    await supervisor.stop()
  }
})
