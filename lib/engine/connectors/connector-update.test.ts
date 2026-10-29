import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { slackConnector } from "@/engine/connectors/slack-connector"
import { discordConnector } from "@/engine/connectors/discord-connector"
import { ghConnector } from "@/engine/connectors/gh-connector"
import { slackConnectorSchema } from "@/engine/connectors/slack-connector-schema"

const setup = () =>
  new Funnel({
    connectors: [slackConnector(), discordConnector(), ghConnector()],
    channels: [
      {
        name: "ops",
        connectors: [
          {
            type: "slack",
            name: "slack",
            botToken: "xoxb-example",
            appToken: "xapp-example",
            minify: true,
          },
          { type: "discord", name: "discord", botToken: "example-discord-token" },
          { type: "gh", name: "gh", token: "example-code-token", pollInterval: 60 },
        ],
      },
    ],
  })

test("Slack minify updates persist and token updates preserve that choice", () => {
  const funnel = setup()
  const original = funnel.channels.getConnector("ops", "slack")!
  funnel.channels.updateConnector("ops", "slack", { minify: false })
  expect(slackConnectorSchema.parse(funnel.channels.getConnector("ops", "slack")).minify).toBe(
    false,
  )
  funnel.channels.updateConnector("ops", "slack", { appToken: "xapp-replacement" })
  const updated = slackConnectorSchema.parse(funnel.channels.getConnector("ops", "slack"))
  expect(updated.minify).toBe(false)
  expect(updated.id).toBe(original.id)
  expect(updated.botToken).toBe("xoxb-example")
})

test("invalid minify updates reject without replacing the saved connector", () => {
  const funnel = setup()
  const before = JSON.stringify(funnel.channels.getConnector("ops", "slack"))
  expect(() => funnel.channels.updateConnector("ops", "slack", { minify: "false" })).toThrow()
  expect(JSON.stringify(funnel.channels.getConnector("ops", "slack"))).toBe(before)
})

test.each([
  { name: "slack", field: "botToken" },
  { name: "slack", field: "appTokenEnv" },
  { name: "slack", field: "appToken" },
  { name: "slack", field: "botTokenEnv" },
  { name: "discord", field: "botToken" },
  { name: "discord", field: "botTokenEnv" },
  { name: "gh", field: "token" },
  { name: "gh", field: "tokenEnv" },
])("invalid $name $field updates reject instead of silently retaining old credentials", (input) => {
  const funnel = setup()
  const before = JSON.stringify(funnel.channels.getConnector("ops", input.name))
  expect(() => funnel.channels.updateConnector("ops", input.name, { [input.field]: 42 })).toThrow()
  expect(JSON.stringify(funnel.channels.getConnector("ops", input.name))).toBe(before)
})

test("invalid GitHub poll interval updates reject rather than reporting success", () => {
  const funnel = setup()
  expect(() => funnel.channels.updateConnector("ops", "gh", { pollInterval: "10" })).toThrow()
})

test("GitHub interval updates survive an unrelated credential update", () => {
  const funnel = setup()
  funnel.channels.updateConnector("ops", "gh", { pollInterval: 10 })
  funnel.channels.updateConnector("ops", "gh", { token: "example-replacement-token" })
  expect(funnel.channels.getConnector("ops", "gh")).toMatchObject({ pollInterval: 10 })
})

test("a mixed valid and invalid credential update cannot partially replace a slot", () => {
  const funnel = setup()
  const before = JSON.stringify(funnel.channels.getConnector("ops", "slack"))
  expect(() =>
    funnel.channels.updateConnector("ops", "slack", {
      botToken: "xoxb-replacement",
      botTokenEnv: 42,
    }),
  ).toThrow()
  expect(JSON.stringify(funnel.channels.getConnector("ops", "slack"))).toBe(before)
})
