import type { FunnelChannels } from "@/engine/channels/channels"
import { FunnelDotenvReader } from "@/engine/local-config/dotenv-reader"
import type { ChannelSpec, ConnectorSpec } from "@/engine/local-config/local-config-schema"
import { FunnelTokenPrompter } from "@/engine/token-prompter/token-prompter"
import type { DiscordConnectorConfig } from "@/connectors/discord-connector-schema"
import type { SlackConnectorConfig } from "@/connectors/slack-connector-schema"

type Deps = {
  channels: FunnelChannels
  dotenv: FunnelDotenvReader
  prompter: FunnelTokenPrompter
  env?: NodeJS.ProcessEnv
}

const arraysEqual = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }

  return true
}

const recordsEqual = (
  a: Record<string, string>,
  b: Record<string, string>,
): boolean => {
  const keys = Object.keys(a)

  if (keys.length !== Object.keys(b).length) return false

  for (const key of keys) {
    if (a[key] !== b[key]) return false
  }

  return true
}

/**
 * Reconciles a single funnel.json channel spec with `~/.funnel/settings.json`.
 * The spec is the source of truth for the channel it declares:
 *
 *   - missing channel → created
 *   - declared connector matched by name → tokens reconciled
 *   - declared connector matched by token in the same channel under a
 *     different name → renamed in place (then tokens reconciled)
 *   - declared connector with no match → added
 *   - any connector left in the channel that the spec did not touch → removed
 *
 * Removal only fires when the channel spec has a `connectors` field. An
 * absent field means "do not manage connectors from here" and leaves
 * everything in `~/.funnel` alone. Other channels in funnel.json (not
 * passed to this call) are untouched.
 */
export class FunnelLocalConfigSync {
  private readonly channels: FunnelChannels
  private readonly dotenv: FunnelDotenvReader
  private readonly prompter: FunnelTokenPrompter
  private readonly env: NodeJS.ProcessEnv

  constructor(deps: Deps) {
    this.channels = deps.channels
    this.dotenv = deps.dotenv
    this.prompter = deps.prompter
    this.env = deps.env ?? process.env
    Object.freeze(this)
  }

  async ensure(channel: ChannelSpec, cwd: string): Promise<void> {
    const existing = this.channels.get(channel.name)

    if (!existing) {
      this.channels.add({
        name: channel.name,
        options: channel.options ?? [],
        env: channel.env ?? {},
      })
    } else {
      const nextOptions = channel.options ?? []
      const nextEnv = channel.env ?? {}

      if (!arraysEqual(existing.options, nextOptions)) {
        this.channels.setOptions(channel.name, nextOptions)
      }

      if (!recordsEqual(existing.env, nextEnv)) {
        this.channels.setEnv(channel.name, nextEnv)
      }
    }

    if (channel.connectors === undefined) return

    const dotenv = this.dotenv.read(cwd)
    const touched = new Set<string>()

    for (const spec of channel.connectors) {
      const id = await this.ensureConnector(channel.name, spec, dotenv)
      touched.add(id)
    }

    this.removeExtras(channel.name, touched)
  }

  private async ensureConnector(
    channelName: string,
    spec: ConnectorSpec,
    dotenv: Record<string, string>,
  ): Promise<string> {
    if (spec.type === "slack") return await this.ensureSlack(channelName, spec, dotenv)
    if (spec.type === "discord") return await this.ensureDiscord(channelName, spec, dotenv)
    if (spec.type === "gh") return this.ensureGh(channelName, spec)

    return this.ensureSchedule(channelName, spec)
  }

  private async ensureSlack(
    channelName: string,
    spec: Extract<ConnectorSpec, { type: "slack" }>,
    dotenv: Record<string, string>,
  ): Promise<string> {
    const byName = this.findExistingSlack(channelName, spec.name)

    const botToken = await this.resolveField({
      literal: spec.botToken,
      envVar: spec.env?.botToken,
      dotenv,
      label: `${spec.name}.botToken`,
      existing: byName?.botToken,
    })
    const appToken = await this.resolveField({
      literal: spec.appToken,
      envVar: spec.env?.appToken,
      dotenv,
      label: `${spec.name}.appToken`,
      existing: byName?.appToken,
    })

    if (byName) {
      if (byName.botToken !== botToken || byName.appToken !== appToken) {
        this.channels.updateSlackConnector(channelName, spec.name, { botToken, appToken })
      }

      return byName.id
    }

    const byToken = this.findSlackByToken(channelName, [botToken, appToken])

    if (byToken) {
      this.channels.renameConnector(channelName, byToken.name, spec.name)

      if (byToken.botToken !== botToken || byToken.appToken !== appToken) {
        this.channels.updateSlackConnector(channelName, spec.name, { botToken, appToken })
      }

      return byToken.id
    }

    const added = this.channels.addConnector(channelName, {
      type: "slack",
      name: spec.name,
      botToken,
      appToken,
    })

    return added.id
  }

  private async ensureDiscord(
    channelName: string,
    spec: Extract<ConnectorSpec, { type: "discord" }>,
    dotenv: Record<string, string>,
  ): Promise<string> {
    const byName = this.findExistingDiscord(channelName, spec.name)

    const botToken = await this.resolveField({
      literal: spec.botToken,
      envVar: spec.env?.botToken,
      dotenv,
      label: `${spec.name}.botToken`,
      existing: byName?.botToken,
    })

    if (byName) {
      if (byName.botToken !== botToken) {
        this.channels.updateDiscordConnector(channelName, spec.name, { botToken })
      }

      return byName.id
    }

    const byToken = this.findDiscordByToken(channelName, botToken)

    if (byToken) {
      this.channels.renameConnector(channelName, byToken.name, spec.name)

      if (byToken.botToken !== botToken) {
        this.channels.updateDiscordConnector(channelName, spec.name, { botToken })
      }

      return byToken.id
    }

    const added = this.channels.addConnector(channelName, {
      type: "discord",
      name: spec.name,
      botToken,
    })

    return added.id
  }

  private ensureGh(
    channelName: string,
    spec: Extract<ConnectorSpec, { type: "gh" }>,
  ): string {
    const existing = this.channels.getConnector(channelName, spec.name)

    if (existing && existing.type !== "gh") {
      throw new Error(
        `connector "${spec.name}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "gh"`,
      )
    }

    if (existing && existing.type === "gh") {
      if (spec.pollInterval !== undefined && existing.pollInterval !== spec.pollInterval) {
        this.channels.updateGhConnector(channelName, spec.name, { pollInterval: spec.pollInterval })
      }

      return existing.id
    }

    const added = this.channels.addConnector(channelName, {
      type: "gh",
      name: spec.name,
      ...(spec.pollInterval !== undefined ? { pollInterval: spec.pollInterval } : {}),
    })

    return added.id
  }

  private ensureSchedule(
    channelName: string,
    spec: Extract<ConnectorSpec, { type: "schedule" }>,
  ): string {
    const existing = this.channels.getConnector(channelName, spec.name)

    if (existing && existing.type !== "schedule") {
      throw new Error(
        `connector "${spec.name}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "schedule"`,
      )
    }

    if (existing && existing.type === "schedule") return existing.id

    const added = this.channels.addConnector(channelName, { type: "schedule", name: spec.name })

    return added.id
  }

  private findExistingSlack(
    channelName: string,
    connectorName: string,
  ): SlackConnectorConfig | null {
    const existing = this.channels.getConnector(channelName, connectorName)

    if (!existing) return null

    if (existing.type !== "slack") {
      throw new Error(
        `connector "${connectorName}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "slack"`,
      )
    }

    return existing
  }

  private findExistingDiscord(
    channelName: string,
    connectorName: string,
  ): DiscordConnectorConfig | null {
    const existing = this.channels.getConnector(channelName, connectorName)

    if (!existing) return null

    if (existing.type !== "discord") {
      throw new Error(
        `connector "${connectorName}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "discord"`,
      )
    }

    return existing
  }

  private findSlackByToken(channelName: string, tokens: string[]): SlackConnectorConfig | null {
    const channel = this.channels.get(channelName)

    if (!channel) return null

    for (const connector of channel.connectors) {
      if (connector.type !== "slack") continue

      if (tokens.includes(connector.botToken) || tokens.includes(connector.appToken)) {
        return connector
      }
    }

    return null
  }

  private findDiscordByToken(channelName: string, token: string): DiscordConnectorConfig | null {
    const channel = this.channels.get(channelName)

    if (!channel) return null

    for (const connector of channel.connectors) {
      if (connector.type !== "discord") continue

      if (connector.botToken === token) return connector
    }

    return null
  }

  private removeExtras(channelName: string, touched: Set<string>): void {
    const channel = this.channels.get(channelName)

    if (!channel) return

    const stale = channel.connectors.filter((c) => !touched.has(c.id))

    for (const connector of stale) {
      this.channels.removeConnector(channelName, connector.name)
    }
  }

  private async resolveField(input: {
    literal: string | undefined
    envVar: string | undefined
    dotenv: Record<string, string>
    label: string
    existing: string | undefined
  }): Promise<string> {
    if (input.literal !== undefined && input.envVar !== undefined) {
      throw new Error(
        `${input.label} is set both as a literal and as env.${input.label.split(".").pop()}; pick one`,
      )
    }

    if (input.literal !== undefined && input.literal !== "") return input.literal

    if (input.envVar !== undefined && input.envVar !== "") {
      const fromProcessEnv = this.env[input.envVar]

      if (fromProcessEnv) return fromProcessEnv

      const fromDotenv = input.dotenv[input.envVar]

      if (fromDotenv) return fromDotenv

      throw new Error(
        `${input.label} references env var "${input.envVar}" but it is not set in process env or .env.local`,
      )
    }

    if (input.existing) return input.existing

    return await this.prompter.promptSecret(input.label)
  }
}
