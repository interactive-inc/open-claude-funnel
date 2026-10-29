import { expect, test } from "bun:test"
import { FunnelBroadcaster } from "@/gateway/broadcaster"

test("derived publications reach every observer in ascending offset order", () => {
  const broadcaster = new FunnelBroadcaster()
  const first: number[] = []
  const second: number[] = []
  broadcaster.subscribe((event) => {
    first.push(event.offset)
    if (event.offset === 1) broadcaster.broadcast("derived")
  })
  broadcaster.subscribe((event) => {
    second.push(event.offset)
  })
  broadcaster.broadcast("original")
  expect(first).toEqual([1, 2])
  expect(second).toEqual([1, 2])
})

test("long derived publication chains preserve observer order", () => {
  const errors: Error[] = []
  const broadcaster = new FunnelBroadcaster({
    onError: (error) => {
      errors.push(error)
    },
  })
  const offsets: number[] = []
  broadcaster.subscribe((event) => {
    if (event.offset < 5000) broadcaster.broadcast("derived")
  })
  broadcaster.subscribe((event) => {
    offsets.push(event.offset)
  })
  broadcaster.broadcast("original")
  expect(errors).toEqual([])
  expect(offsets).toHaveLength(5000)
  expect(offsets.every((offset, index) => offset === index + 1)).toBe(true)
})

test("publications from an observer error sink preserve observer order", () => {
  const broadcaster = new FunnelBroadcaster({
    onError: () => {
      broadcaster.broadcast("error report")
    },
  })
  const offsets: number[] = []
  broadcaster.subscribe((event) => {
    if (event.offset === 1) throw new Error("observer failed")
  })
  broadcaster.subscribe((event) => {
    offsets.push(event.offset)
  })
  broadcaster.broadcast("original")
  expect(offsets).toEqual([1, 2])
})

test("multiple derived publications remain FIFO across notification batches", () => {
  const broadcaster = new FunnelBroadcaster()
  const seen: string[] = []
  broadcaster.subscribe((event) => {
    if (event.content === "original") {
      broadcaster.broadcast("first derived")
      broadcaster.broadcast("second derived")
    }
    if (event.content === "first derived") broadcaster.broadcast("third derived")
  })
  broadcaster.subscribe((event) => {
    seen.push(event.content)
  })
  broadcaster.broadcast("original")
  expect(seen).toEqual(["original", "first derived", "second derived", "third derived"])
})

test("a failed derived publication cannot leave a phantom notification or stop later observers", () => {
  const errors: string[] = []
  const broadcaster = new FunnelBroadcaster({
    record: (event) => {
      if (event.content === "failed") throw new Error("persistence unavailable")
    },
    onError: (error) => {
      errors.push(error.message)
    },
  })
  const seen: string[] = []
  broadcaster.subscribe((event) => {
    if (event.content === "original") {
      broadcaster.broadcast("accepted")
      broadcaster.broadcast("failed")
    }
  })
  broadcaster.subscribe((event) => {
    seen.push(event.content)
  })
  broadcaster.broadcast("original")
  broadcaster.broadcast("later")
  expect(seen).toEqual(["original", "accepted", "later"])
  expect(errors).toEqual(["persistence unavailable"])
})
