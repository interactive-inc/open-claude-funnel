import { expect, test } from "bun:test"
import { agentSdkInput } from "@/claude"
import { Funnel } from "@/funnel"
import type { ReplayableEvent } from "@/gateway/broadcaster"

const event: ReplayableEvent = { content: "late", offset: 1 }
const done = { value: undefined, done: true } as const

test("SDK input failure settles sibling reads and discards late source events", async () => {
  const read = Promise.withResolvers<IteratorResult<ReplayableEvent>>()
  const failure = new Error("read failed")
  let reads = 0
  let returns = 0
  const input = agentSdkInput({
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (++reads === 1) return read.promise
          return Promise.reject(failure)
        },
        async return() {
          returns++
          return done
        },
      }
    },
  })
  const pending = input.next()
  try {
    await expect(input.next()).rejects.toBe(failure)
    expect(await pending).toEqual(done)
    read.resolve({ value: event, done: false })
    expect(await input.next()).toEqual(done)
    await input.return!()
    expect(returns).toBe(1)
  } finally {
    read.resolve(done)
    await input.return!()
  }
})

for (const stage of ["read", "transform"] as const) {
  for (const cleanup of ["complete", "reject", "pending"] as const) {
    test(`SDK input closes on ${stage} failure while cleanup is ${cleanup}`, async () => {
      const failure = new Error("input failed")
      const cleanupFailure = new Error("cleanup failed")
      const release = Promise.withResolvers<void>()
      let reads = 0
      let returns = 0
      const broken: ReplayableEvent = {
        offset: 1,
        get content(): string {
          throw failure
        },
      }
      const input = agentSdkInput({
        [Symbol.asyncIterator]() {
          return {
            async next() {
              reads++
              if (stage === "read") throw failure
              return { done: false, value: broken } as const
            },
            async return() {
              returns++
              if (cleanup === "reject") throw cleanupFailure
              if (cleanup === "pending") await release.promise
              return done
            },
          }
        },
      })
      try {
        await expect(input.next()).rejects.toBe(failure)
        expect(returns).toBe(1)
        expect(await input.next()).toEqual(done)
        expect(reads).toBe(1)
        release.resolve()
        if (cleanup === "reject") await expect(input.return!()).rejects.toBe(cleanupFailure)
        else expect(await input.return!()).toEqual(done)
        expect(returns).toBe(1)
      } finally {
        release.resolve()
        await input.return!().catch(() => {})
      }
    })
  }
}

test("closing SDK input without a source return method prevents later reads", async () => {
  let reads = 0
  const input = agentSdkInput({
    [Symbol.asyncIterator]() {
      return {
        async next() {
          reads++
          return { value: event, done: false }
        },
      }
    },
  })
  await input.return!()
  expect(await input.next()).toEqual(done)
  expect(reads).toBe(0)
})

test("SDK input discards a pending source event after return", async () => {
  const read = Promise.withResolvers<IteratorResult<ReplayableEvent>>()
  const input = agentSdkInput({
    [Symbol.asyncIterator]() {
      return { next: () => read.promise }
    },
  })
  const pending = input.next()
  await input.return!()
  read.resolve({ value: event, done: false })
  expect(await pending).toEqual(done)
})

test("SDK input cancellation discards an in-flight native event and releases its subscription", async () => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayModule({ token: "" })
  const input = agentSdkInput(gateway.events({ channel: "ops" }))
  try {
    gateway.emit({ channel: "ops", content: "queued" })
    const pending = input.next()
    const closing = input.return!()
    expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    await closing
    expect(await pending).toEqual(done)
    expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
  } finally {
    await input.return!()
    await gateway.stop()
  }
})

test("SDK input observes a late source rejection after cancellation", async () => {
  const read = Promise.withResolvers<IteratorResult<ReplayableEvent>>()
  const input = agentSdkInput({
    [Symbol.asyncIterator]() {
      return { next: () => read.promise }
    },
  })
  const pending = input.next()
  await input.return!()
  read.reject(new Error("late source failure"))
  expect(await pending).toEqual(done)
  await Bun.sleep(0)
})

test("SDK input return settles pending reads even if the source cannot cancel", async () => {
  const read = Promise.withResolvers<IteratorResult<ReplayableEvent>>()
  const input = agentSdkInput({
    [Symbol.asyncIterator]() {
      return { next: () => read.promise }
    },
  })
  const pending = input.next()
  await input.return!()
  try {
    expect(await Promise.race([pending, Bun.sleep(30).then(() => "still waiting")])).toEqual(done)
  } finally {
    read.resolve(done)
    await pending
  }
})

test("concurrent SDK input returns call source cleanup once and await the same completion", async () => {
  const cleanup = Promise.withResolvers<void>()
  let returns = 0
  const input = agentSdkInput({
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { value: event, done: false }
        },
        async return() {
          returns++
          await cleanup.promise
          return done
        },
      }
    },
  })
  const first = input.return!()
  const second = input.return!()
  try {
    await Promise.resolve()
    expect(returns).toBe(1)
  } finally {
    cleanup.resolve()
  }
  expect(await first).toEqual(done)
  expect(await second).toEqual(done)
})

test("failed source cleanup is propagated but cannot reopen SDK input", async () => {
  const input = agentSdkInput({
    [Symbol.asyncIterator]() {
      return {
        async next() {
          return { value: event, done: false }
        },
        async return(): Promise<IteratorResult<ReplayableEvent>> {
          throw new Error("cleanup failed")
        },
      }
    },
  })
  await expect(input.return!()).rejects.toThrow("cleanup failed")
  expect(await input.next()).toEqual(done)
})

test("SDK input does not read the source again after natural completion", async () => {
  let reads = 0
  const input = agentSdkInput({
    [Symbol.asyncIterator]() {
      return {
        async next() {
          reads++
          return done
        },
      }
    },
  })
  expect(await input.next()).toEqual(done)
  expect(await input.next()).toEqual(done)
  expect(reads).toBe(1)
})
