import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"

/** Exercise validation through the actual HTTP upgrade boundary. */
const upgradeStatus = async (query: string, upgrade = "websocket", token = "") => {
  const gateway = new Funnel({ channels: [{ name: "ops" }] }).gatewayServer({ port: 0, token })
  try {
    await gateway.start()
    const response = await fetch(`http://127.0.0.1:${gateway.port}/ws${query}`, {
      headers: {
        upgrade,
        connection: "Upgrade",
        "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
        "sec-websocket-version": "13",
      },
    })
    return response.status
  } finally {
    await gateway.stop()
  }
}

test.each(["WebSocket", "WEBSOCKET", "wEbSoCkEt"])(
  "WebSocket protocol names are case-insensitive through the HTTP boundary: %s",
  async (upgrade) => {
    expect(await upgradeStatus("?channel=ops", upgrade)).toBe(101)
    expect(await upgradeStatus("?channel=ops", upgrade, "example-token")).toBe(401)
  },
)

test.each(["", "?channel="])(
  "a missing channel is rejected instead of silently subscribing to nothing: %s",
  async (query) => {
    expect(await upgradeStatus(query)).toBe(400)
  },
)

test.each(["", "-1", "1.5", "1x", "NaN", "Infinity", "9007199254740992", "1e3"])(
  "an invalid replay cursor is rejected instead of silently changing replay: %s",
  async (since) => {
    expect(await upgradeStatus(`?channel=ops&since=${encodeURIComponent(since)}`)).toBe(400)
  },
)

test.each(["?channel=ops", "?channel=ops&since=0", "?channel=ops&since=9007199254740991"])(
  "a valid subscription still upgrades successfully: %s",
  async (query) => {
    expect(await upgradeStatus(query)).toBe(101)
  },
)
