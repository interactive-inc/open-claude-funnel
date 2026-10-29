import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("a throwing error reporter does not suppress healthy observers", () => {
  const seen: string[] = []
  const broadcaster = new FunnelBroadcaster({
    onError() {
      throw new Error("reporter unavailable")
    },
  })
  broadcaster.subscribe(() => {
    throw new Error("observer failed")
  })
  broadcaster.subscribe((event) => {
    seen.push(event.content)
  })
  expect(() => broadcaster.broadcast("message")).not.toThrow()
  expect(seen).toEqual(["message"])
})

test("a throwing logger does not suppress the independent reporter or healthy observers", () => {
  class ThrowingLogger extends MemoryFunnelLogger {
    override error(): void {
      throw new Error("logger unavailable")
    }
  }
  const reported: string[] = []
  const seen: string[] = []
  const broadcaster = new FunnelBroadcaster({
    logger: new ThrowingLogger(),
    onError: (error) => {
      reported.push(error.message)
    },
  })
  broadcaster.subscribe(() => {
    throw new Error("observer failed")
  })
  broadcaster.subscribe((event) => {
    seen.push(event.content)
  })
  expect(() => broadcaster.broadcast("message")).not.toThrow()
  expect(reported).toEqual(["observer failed"])
  expect(seen).toEqual(["message"])
})

test("thenable observer rejections reach the host reporter", async () => {
  const reported = Promise.withResolvers<Error>()
  const broadcaster = new FunnelBroadcaster({
    onError: (error) => {
      reported.resolve(error)
    },
  })
  broadcaster.subscribe(() => ({
    // oxlint-disable-next-line unicorn/no-thenable -- Deliberately exercise a host-supplied thenable.
    then(_resolve: unknown, reject: (error: Error) => void) {
      reject(new Error("thenable failed"))
    },
  }))
  broadcaster.broadcast("message")
  const deadline = Promise.withResolvers<Error>()
  const timer = setTimeout(() => deadline.resolve(new Error("observer rejection was ignored")), 100)
  try {
    expect((await Promise.race([reported.promise, deadline.promise])).message).toBe(
      "thenable failed",
    )
  } finally {
    clearTimeout(timer)
  }
})

test("observer registration changes do not redeliver the event being dispatched", () => {
  const broadcaster = new FunnelBroadcaster()
  const state = { calls: 0, unsubscribe: () => {} }
  const handler = () => {
    state.calls += 1
    if (state.calls !== 1) return
    state.unsubscribe()
    state.unsubscribe = broadcaster.subscribe(handler)
  }
  state.unsubscribe = broadcaster.subscribe(handler)
  broadcaster.broadcast("first")
  expect(state.calls).toBe(1)
  broadcaster.broadcast("second")
  expect(state.calls).toBe(2)
})

test("an observer registered by persistence starts with the next broadcast", () => {
  const seen: string[] = []
  const observer = (event: { content: string }) => {
    seen.push(event.content)
  }
  const broadcaster = new FunnelBroadcaster({
    record: () => {
      broadcaster.subscribe(observer)
    },
  })
  broadcaster.broadcast("first")
  expect(seen).toEqual([])
  broadcaster.broadcast("second")
  expect(seen).toEqual(["second"])
})

test("an observer unsubscribed before its turn does not receive the active event", () => {
  const broadcaster = new FunnelBroadcaster()
  const seen: string[] = []
  broadcaster.subscribe(() => {
    unsubscribe()
  })
  const unsubscribe = broadcaster.subscribe((event) => {
    seen.push(event.content)
  })
  broadcaster.broadcast("message")
  expect(seen).toEqual([])
})

test("an old unsubscribe cannot remove a later registration of the same observer", () => {
  const broadcaster = new FunnelBroadcaster()
  const seen: string[] = []
  const handler = (event: { content: string }) => {
    seen.push(event.content)
  }
  const old = broadcaster.subscribe(handler)
  old()
  const current = broadcaster.subscribe(handler)
  old()
  expect(broadcaster.getMetrics().subscribers).toBe(1)
  broadcaster.broadcast("current")
  expect(seen).toEqual(["current"])
  current()
  expect(broadcaster.getMetrics().subscribers).toBe(0)
})

test("duplicate subscriptions of an active observer still share one registration", () => {
  const broadcaster = new FunnelBroadcaster()
  let calls = 0
  const handler = () => {
    calls++
  }
  const first = broadcaster.subscribe(handler)
  const second = broadcaster.subscribe(handler)
  expect(broadcaster.getMetrics().subscribers).toBe(1)
  broadcaster.broadcast("input")
  expect(calls).toBe(1)
  first()
  second()
  expect(broadcaster.getMetrics().subscribers).toBe(0)
})

for (const queued of [false, true]) {
  test(`replacing an observer before its turn skips prior ${queued ? "queued" : "active"} notifications`, () => {
    const broadcaster = new FunnelBroadcaster()
    const seen: string[] = []
    const handler = (event: { content: string }) => {
      seen.push(event.content)
    }
    broadcaster.subscribe((event) => {
      if (event.content !== "original") return
      if (queued) broadcaster.broadcast("queued")
      unsubscribe()
      unsubscribe = broadcaster.subscribe(handler)
    })
    let unsubscribe = broadcaster.subscribe(handler)
    broadcaster.broadcast("original")
    expect(seen).toEqual([])
    broadcaster.broadcast("next")
    expect(seen).toEqual(["next"])
    unsubscribe()
  })
}

test("async observer and error-sink failures do not produce unhandled rejections", async () => {
  const dir = mkdtempSync(join(tmpdir(), "funnel-observer-errors-"))
  const script = join(dir, "observer-errors.ts")
  await Bun.write(
    script,
    `
    import { FunnelBroadcaster } from ${JSON.stringify(import.meta.resolve("@/gateway/broadcaster"))}
    import { MemoryFunnelLogger } from ${JSON.stringify(import.meta.resolve("@/engine/logger/memory-logger"))}
    const state = { seen: 0, reported: 0, unhandled: 0 }
    process.on("unhandledRejection", () => { state.unhandled++ })
    class RejectingLogger extends MemoryFunnelLogger {
      async error() { throw new Error("async logger unavailable") }
    }
    const broadcaster = new FunnelBroadcaster({
      logger: new RejectingLogger(),
      onError: async () => { state.reported++; throw new Error("async reporter unavailable") },
    })
    broadcaster.subscribe(async () => { throw new Error("async observer failed") })
    broadcaster.subscribe(() => ({ then(_resolve, reject) { reject(new Error("thenable failed")) } }))
    broadcaster.subscribe(() => { state.seen++ })
    broadcaster.broadcast("message")
    await Bun.sleep(10)
    console.log(JSON.stringify(state))
  `,
  )
  const child = Bun.spawn([process.execPath, script], { stdout: "pipe", stderr: "pipe" })
  try {
    const output = await new Response(child.stdout).text()
    expect(await new Response(child.stderr).text()).toBe("")
    expect(await child.exited).toBe(0)
    expect(JSON.parse(output)).toEqual({ seen: 1, reported: 2, unhandled: 0 })
  } finally {
    child.kill()
    await child.exited
    rmSync(dir, { recursive: true, force: true })
  }
})
