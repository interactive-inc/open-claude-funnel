import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { MemoryFunnelEventLog } from "@/gateway/event-log/memory-event-log"
import { SqliteFunnelEventLog } from "@/gateway/event-log/sqlite-event-log"

test("switching to exclusive delivery closes anonymous native input before assigning new work", async () => {
  const funnel = new Funnel({ channels: [{ name: "ops" }] })
  const gateway = funnel.gatewayModule({ token: "" })
  const anonymous = gateway.events({ channel: "ops" })
  const worker = gateway.events({ channel: "ops", subscriberId: "worker" })
  const canceled = anonymous.next().then(
    () => null,
    (error: unknown) => error,
  )
  try {
    funnel.channels.setDelivery("ops", "exclusive")
    gateway.emit({ channel: "ops", content: "exclusive work" })
    expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(1)
    expect(await canceled).toMatchObject({
      message: "exclusive event streams require a stable subscriber id",
    })
    expect((await worker.next()).value.content).toBe("exclusive work")
    const channelId = funnel.channels.get("ops")!.id
    expect(gateway.getEventLog().loadSince(0)[0]?.exclusive?.[channelId]).toBe("worker")
  } finally {
    await anonymous.return()
    await worker.return()
    await gateway.stop()
  }
})

for (const storage of ["memory", "sqlite"] as const) {
  test(`${storage} replay keeps work unassigned after anonymous native input loses eligibility`, async () => {
    const funnel = new Funnel({ channels: [{ name: "ops" }] })
    const store =
      storage === "memory"
        ? new MemoryFunnelEventLog()
        : new SqliteFunnelEventLog({ path: ":memory:" })
    const gateway = funnel.gatewayModule({ token: "", eventLog: store })
    const anonymous = gateway.events({ channel: "ops" })
    try {
      funnel.channels.setDelivery("ops", "exclusive")
      gateway.emit({ channel: "ops", content: "offline work" })
      const channelId = funnel.channels.get("ops")!.id
      expect(store.loadSince(0)[0]?.exclusive?.[channelId]).toBeNull()
      await expect(anonymous.next()).rejects.toThrow("stable subscriber id")
      const worker = gateway.events({ channel: "ops", subscriberId: "worker", since: 0 })
      try {
        expect((await worker.next()).value.content).toBe("offline work")
      } finally {
        await worker.return()
      }
    } finally {
      await anonymous.return()
      await gateway.stop()
      store.close()
    }
  })
}

test("native inputs with stable ids continue across delivery mode changes", async () => {
  const funnel = new Funnel({ channels: [{ name: "ops" }] })
  const gateway = funnel.gatewayModule({ token: "" })
  const first = gateway.events({ channel: "ops", subscriberId: "first" })
  const second = gateway.events({ channel: "ops", subscriberId: "second" })
  try {
    gateway.emit({ channel: "ops", content: "fanout before" })
    expect((await first.next()).value.content).toBe("fanout before")
    expect((await second.next()).value.content).toBe("fanout before")
    funnel.channels.setDelivery("ops", "exclusive")
    gateway.emit({ channel: "ops", content: "exclusive" })
    expect((await first.next()).value.content).toBe("exclusive")
    funnel.channels.setDelivery("ops", "fanout")
    gateway.emit({ channel: "ops", content: "fanout after" })
    expect((await first.next()).value.content).toBe("fanout after")
    expect((await second.next()).value.content).toBe("fanout after")
    expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(2)
  } finally {
    await first.return()
    await second.return()
    await gateway.stop()
  }
})

test("an anonymous WebSocket can continue live exclusive delivery while anonymous native input closes", async () => {
  const funnel = new Funnel({ channels: [{ name: "ops" }] })
  const gateway = funnel.gatewayServer({ port: 0, token: "" })
  const anonymous = gateway.events({ channel: "ops" })
  await gateway.start()
  const socket = new WebSocket(`ws://127.0.0.1:${gateway.port}/ws?channel=ops`)
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket open timed out")), 1000)
      socket.onopen = () => {
        clearTimeout(timer)
        resolve()
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error("WebSocket open failed"))
      }
    })
    const received = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket delivery timed out")), 1000)
      socket.onmessage = (event) => {
        clearTimeout(timer)
        resolve(String(event.data))
      }
      socket.onerror = () => {
        clearTimeout(timer)
        reject(new Error("WebSocket delivery failed"))
      }
    })
    funnel.channels.setDelivery("ops", "exclusive")
    gateway.emit({ channel: "ops", content: "live WebSocket work" })
    expect(JSON.parse(await received).content).toBe("live WebSocket work")
    await expect(anonymous.next()).rejects.toThrow("stable subscriber id")
    expect(socket.readyState).toBe(WebSocket.OPEN)
    expect(gateway.getBroadcaster().getMetrics().subscribers).toBe(0)
    expect(gateway.getStatus().clients).toBe(1)
  } finally {
    socket.close()
    await anonymous.return()
    await gateway.stop()
  }
})
