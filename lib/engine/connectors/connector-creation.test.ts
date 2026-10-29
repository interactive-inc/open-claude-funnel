import { expect, test } from "bun:test"
import { Funnel } from "@/funnel"
import { slackConnector } from "@/engine/connectors/slack-connector"
import { discordConnector } from "@/engine/connectors/discord-connector"
import { ghConnector } from "@/engine/connectors/gh-connector"

const setup = () =>
  new Funnel({
    connectors: [slackConnector(), discordConnector(), ghConnector()],
    channels: [{ name: "ops" }],
  })

test.each([
  { type: "slack", field: "botToken", value: 42 },
  { type: "slack", field: "botTokenEnv", value: 42 },
  { type: "slack", field: "appToken", value: 42 },
  { type: "slack", field: "appTokenEnv", value: 42 },
  { type: "slack", field: "minify", value: "false" },
  { type: "discord", field: "botToken", value: 42 },
  { type: "discord", field: "botTokenEnv", value: 42 },
  { type: "gh", field: "token", value: 42 },
  { type: "gh", field: "tokenEnv", value: 42 },
  { type: "gh", field: "pollInterval", value: "10" },
])(
  "adding $type rejects an invalid $field without storing a connector",
  ({ type, field, value }) => {
    const funnel = setup()
    expect(() =>
      funnel.channels.addConnector("ops", { type, name: "new", [field]: value }),
    ).toThrow()
    expect(funnel.channels.listConnectors("ops")).toEqual([])
  },
)

test("creation preserves omitted fields, explicit false, and valid environment references", () => {
  const funnel = setup()
  expect(funnel.channels.addConnector("ops", { type: "slack", name: "default" })).toMatchObject({
    minify: true,
  })
  const explicit = funnel.channels.addConnector("ops", {
    type: "slack",
    name: "explicit",
    minify: false,
    botTokenEnv: "EXAMPLE_BOT_TOKEN",
    appTokenEnv: "EXAMPLE_APP_TOKEN",
  })
  expect(explicit).toMatchObject({
    minify: false,
    botTokenEnv: "EXAMPLE_BOT_TOKEN",
    appTokenEnv: "EXAMPLE_APP_TOKEN",
  })
  expect(explicit).not.toHaveProperty("botToken")
  expect(explicit).not.toHaveProperty("appToken")
  const gh = funnel.channels.addConnector("ops", {
    type: "gh",
    name: "code",
    pollInterval: 10,
    tokenEnv: "EXAMPLE_CODE_TOKEN",
  })
  expect(gh).toMatchObject({ pollInterval: 10, tokenEnv: "EXAMPLE_CODE_TOKEN" })
})

test("initial channel configuration uses the same creation validation", () => {
  expect(
    () =>
      new Funnel({
        connectors: [slackConnector()],
        channels: [
          { name: "ops", connectors: [{ type: "slack", name: "source", minify: "false" }] },
        ],
      }),
  ).toThrow()
})
