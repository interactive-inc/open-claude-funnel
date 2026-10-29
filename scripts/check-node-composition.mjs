import assert from "node:assert/strict"
import { Funnel } from "../dist/index.js"
import { agentSdkInput, claudeChannelNotification } from "../dist/claude.js"
import { scheduleConnector } from "../dist/connectors/schedule.js"

// A portable deadline also detects leaked handles after the assertions complete.
const deadline = setTimeout(() => {
  console.error("Node composition did not exit within 10 seconds")
  process.exit(1)
}, 10_000)
deadline.unref()

const gateway = new Funnel({
  connectors: [scheduleConnector()],
  channels: [{ name: "smoke", connectors: [{ type: "schedule", name: "clock" }] }],
}).gatewayModule({ token: "" })
const events = gateway.events({ channel: "smoke" })
const input = agentSdkInput(events)
try {
  await gateway.start()
  gateway.emit({ channel: "smoke", content: "ok" })
  assert.equal(JSON.parse((await input.next()).value.message.content).content, "ok")
  assert.equal(
    claudeChannelNotification({ content: "ok", offset: 1 }).params.meta.funnel_offset,
    "1",
  )
  const pending = input.next()
  await gateway.stop()
  assert.equal((await pending).done, true)
} finally {
  await input.return()
  await gateway.stop()
}
console.log("Node SDK input and Channels composition verified")
