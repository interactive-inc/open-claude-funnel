import type { FunnelChannels } from "@/engine/channels/channels"
import { FunnelDotenvReader } from "@/engine/local-config/dotenv-reader"
import type { ConnectorSpec, LocalConfig } from "@/engine/local-config/local-config-schema"
import { FunnelTokenPrompter } from "@/engine/token-prompter/token-prompter"

type Deps = {
  channels: FunnelChannels
  dotenv: FunnelDotenvReader
  prompter: FunnelTokenPrompter
  env?: NodeJS.ProcessEnv
}

/**
 * Reconciles a `funnel.json` spec with `~/.funnel/settings.json`. Creates the
 * channel and any missing connectors, resolves token fields from literal /
 * `env: { ... }` references / prompt, and updates existing connectors when
 * the spec declares a fresh token value. Connectors not mentioned by the
 * spec are left alone — the spec is additive.
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

  async ensure(local: LocalConfig, cwd: string): Promise<void> {
    if (!this.channels.get(local.channel)) {
      this.channels.add({ name: local.channel })
    }

    if (!local.connectors || local.connectors.length === 0) return

    const dotenv = this.dotenv.read(cwd)

    for (const spec of local.connectors) {
      await this.ensureConnector(local.channel, spec, dotenv)
    }
  }

  private async ensureConnector(
    channelName: string,
    spec: ConnectorSpec,
    dotenv: Record<string, string>,
  ): Promise<void> {
    const existing = this.channels.getConnector(channelName, spec.name)

    if (spec.type === "slack") {
      const botToken = await this.resolveField({
        literal: spec.botToken,
        envVar: spec.env?.botToken,
        dotenv,
        label: `${spec.name}.botToken`,
        existing: existing?.type === "slack" ? existing.botToken : undefined,
      })
      const appToken = await this.resolveField({
        literal: spec.appToken,
        envVar: spec.env?.appToken,
        dotenv,
        label: `${spec.name}.appToken`,
        existing: existing?.type === "slack" ? existing.appToken : undefined,
      })

      if (!existing) {
        this.channels.addConnector(channelName, {
          type: "slack",
          name: spec.name,
          botToken,
          appToken,
        })
        return
      }

      if (existing.type !== "slack") {
        throw new Error(
          `connector "${spec.name}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "slack"`,
        )
      }

      if (existing.botToken !== botToken || existing.appToken !== appToken) {
        this.channels.updateSlackConnector(channelName, spec.name, { botToken, appToken })
      }

      return
    }

    if (spec.type === "discord") {
      const botToken = await this.resolveField({
        literal: spec.botToken,
        envVar: spec.env?.botToken,
        dotenv,
        label: `${spec.name}.botToken`,
        existing: existing?.type === "discord" ? existing.botToken : undefined,
      })

      if (!existing) {
        this.channels.addConnector(channelName, {
          type: "discord",
          name: spec.name,
          botToken,
        })
        return
      }

      if (existing.type !== "discord") {
        throw new Error(
          `connector "${spec.name}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "discord"`,
        )
      }

      if (existing.botToken !== botToken) {
        this.channels.updateDiscordConnector(channelName, spec.name, { botToken })
      }

      return
    }

    if (spec.type === "gh") {
      if (!existing) {
        this.channels.addConnector(channelName, {
          type: "gh",
          name: spec.name,
          ...(spec.pollInterval !== undefined ? { pollInterval: spec.pollInterval } : {}),
        })
        return
      }

      if (existing.type !== "gh") {
        throw new Error(
          `connector "${spec.name}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "gh"`,
        )
      }

      if (spec.pollInterval !== undefined && existing.pollInterval !== spec.pollInterval) {
        this.channels.updateGhConnector(channelName, spec.name, { pollInterval: spec.pollInterval })
      }

      return
    }

    if (spec.type === "schedule") {
      if (!existing) {
        this.channels.addConnector(channelName, { type: "schedule", name: spec.name })
        return
      }

      if (existing.type !== "schedule") {
        throw new Error(
          `connector "${spec.name}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "schedule"`,
        )
      }
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
