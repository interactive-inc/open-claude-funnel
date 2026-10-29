import { expect, test } from "bun:test"
import type { ServerWebSocket } from "bun"
import { FunnelBroadcaster } from "@/gateway/broadcaster"

const client = () => ({
  channel: "ops",
  connectors: ["allowed"],
  connectorIds: ["allowed-id"],
  subscriberId: "worker",
})
const publish = (broadcaster: FunnelBroadcaster, connector: string) =>
  broadcaster.broadcast(connector, {
    channelId: "ops",
    connector,
    connectorId: `${connector}-id`,
  })

test("a native subscription reads its replay cursor once", async () => {
  const broadcaster = new FunnelBroadcaster()
  publish(broadcaster, "allowed")
  let reads = 0
  const stream = broadcaster.events(client(), {
    get since() {
      reads++
      return reads === 1 ? 0 : 1
    },
  })
  try {
    publish(broadcaster, "allowed")
    expect((await stream.next()).value.offset).toBe(1)
    expect(reads).toBe(1)
  } finally {
    await stream.return()
  }
})

test("native subscriptions own their connector filter arrays", async () => {
  const broadcaster = new FunnelBroadcaster()
  const data = client()
  const stream = broadcaster.events(data)
  try {
    data.connectors.push("blocked")
    data.connectorIds.push("blocked-id")
    publish(broadcaster, "blocked")
    publish(broadcaster, "allowed")
    expect((await stream.next()).value.content).toBe("allowed")
  } finally {
    await stream.return()
  }
})

test("socket subscriptions own their registration data and filters", () => {
  const broadcaster = new FunnelBroadcaster()
  const data = client()
  const received: string[] = []
  const socket = {
    send: (body: string) => {
      received.push(JSON.parse(body).content)
    },
    getBufferedAmount: () => 0,
  } as unknown as ServerWebSocket<unknown>
  broadcaster.addClient(socket, data)
  data.connectors.push("blocked")
  data.connectorIds.push("blocked-id")
  publish(broadcaster, "blocked")
  data.subscriberId = "changed"
  broadcaster.broadcast("allowed", {
    channelId: "ops",
    connectorId: "allowed-id",
    target: "worker",
  })
  expect(received).toEqual(["allowed"])
})

test("channel filter updates detach caller arrays", async () => {
  const broadcaster = new FunnelBroadcaster()
  const stream = broadcaster.events(client())
  const update = { connectors: ["allowed"], connectorIds: ["allowed-id"] }
  try {
    broadcaster.updateChannel("ops", update)
    update.connectors.push("blocked")
    update.connectorIds.push("blocked-id")
    publish(broadcaster, "blocked")
    publish(broadcaster, "allowed")
    expect((await stream.next()).value.content).toBe("allowed")
    broadcaster.updateChannel("ops", { connectors: ["blocked"], connectorIds: ["blocked-id"] })
    publish(broadcaster, "allowed")
    publish(broadcaster, "blocked")
    expect((await stream.next()).value.content).toBe("blocked")
  } finally {
    await stream.return()
  }
})

test("explicit channel updates also apply to unread native replay", async () => {
  const broadcaster = new FunnelBroadcaster()
  publish(broadcaster, "allowed")
  publish(broadcaster, "blocked")
  const stream = broadcaster.events(client(), { since: 0 })
  try {
    expect((await stream.next()).value.content).toBe("allowed")
    broadcaster.updateChannel("ops", { connectors: ["blocked"], connectorIds: ["blocked-id"] })
    expect((await stream.next()).value.content).toBe("blocked")
  } finally {
    await stream.return()
  }
})

test("diagnostic channel snapshots cannot alter active delivery filters", async () => {
  const broadcaster = new FunnelBroadcaster()
  const stream = broadcaster.events({ channel: "ops", connectors: ["allowed"] })
  try {
    broadcaster.listChannels()[0]!.connectors.push("blocked")
    broadcaster.broadcast("blocked", { channelId: "ops", connector: "blocked" })
    broadcaster.broadcast("allowed", { channelId: "ops", connector: "allowed" })
    expect((await stream.next()).value.content).toBe("allowed")
  } finally {
    await stream.return()
  }
})

for (const method of ["array", "socket"] as const) {
  test(`${method} replay detaches subscription data before calling the store`, () => {
    const data = client()
    const broadcaster = new FunnelBroadcaster({
      replayBufferSize: 0,
      persistentReplay: {
        loadSince(since) {
          data.channel = "other"
          data.connectorIds.push("blocked-id")
          return since === 0
            ? [
                {
                  offset: 1,
                  content: "blocked",
                  meta: { channelId: "other", connectorId: "blocked-id" },
                },
                {
                  offset: 2,
                  content: "allowed",
                  meta: { channelId: "ops", connectorId: "allowed-id" },
                },
              ]
            : []
        },
      },
    })
    broadcaster.seedLatestOffset(2)
    const received: string[] = []
    if (method === "array")
      received.push(...broadcaster.replaySince(0, data).map((event) => event.content))
    else
      broadcaster.replayToClient(
        {
          send: (body: string) => {
            received.push(JSON.parse(body).content)
          },
          getBufferedAmount: () => 0,
        } as unknown as ServerWebSocket<unknown>,
        0,
        data,
      )
    expect(received).toEqual(["allowed"])
  })
}
