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

export type ConnectorSyncOutcome = {
  name: string
  changed: boolean
}

export type LocalConfigSyncResult = {
  touched: ConnectorSyncOutcome[]
  removed: string[]
}

type EnsureOutcome = {
  id: string
  name: string
  changed: boolean
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
 *
 * Returns the per-connector change set so callers (e.g. the claude launcher)
 * can drive listener hot-reload on the gateway after settings are written.
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

  async ensure(channel: ChannelSpec, cwd: string): Promise<LocalConfigSyncResult> {
    const existing = this.channels.get(channel.name)

    if (!existing) {
      this.channels.add({ name: channel.name })
    }

    if (channel.connectors === undefined) return { touched: [], removed: [] }

    const dotenv = this.dotenv.read(cwd)
    const touched: ConnectorSyncOutcome[] = []
    const touchedIds = new Set<string>()

    for (const spec of channel.connectors) {
      const outcome = await this.ensureConnector(channel.name, spec, dotenv)
      touched.push({ name: outcome.name, changed: outcome.changed })
      touchedIds.add(outcome.id)
    }

    const removed = this.removeExtras(channel.name, touchedIds)

    return { touched, removed }
  }

  private async ensureConnector(
    channelName: string,
    spec: ConnectorSpec,
    dotenv: Record<string, string>,
  ): Promise<EnsureOutcome> {
    if (spec.type === "slack") return await this.ensureSlack(channelName, spec, dotenv)
    if (spec.type === "discord") return await this.ensureDiscord(channelName, spec, dotenv)
    if (spec.type === "gh") return this.ensureGh(channelName, spec)

    return this.ensureSchedule(channelName, spec)
  }

  private async ensureSlack(
    channelName: string,
    spec: Extract<ConnectorSpec, { type: "slack" }>,
    dotenv: Record<string, string>,
  ): Promise<EnsureOutcome> {
    const byName = this.findExistingSlack(channelName, spec.name)

    const bot = await this.resolveSlot({
      literal: spec.botToken,
      envVar: spec.env?.botToken,
      dotenv,
      label: `${spec.name}.botToken`,
      existingLiteral: byName?.botToken,
      existingEnv: byName?.botTokenEnv,
    })
    const app = await this.resolveSlot({
      literal: spec.appToken,
      envVar: spec.env?.appToken,
      dotenv,
      label: `${spec.name}.appToken`,
      existingLiteral: byName?.appToken,
      existingEnv: byName?.appTokenEnv,
    })

    const update = {
      botToken: bot.token,
      botTokenEnv: bot.tokenEnv,
      appToken: app.token,
      appTokenEnv: app.tokenEnv,
    }

    if (byName) {
      const unchanged =
        byName.botToken === bot.token &&
        byName.botTokenEnv === bot.tokenEnv &&
        byName.appToken === app.token &&
        byName.appTokenEnv === app.tokenEnv

      if (!unchanged) {
        this.channels.updateSlackConnector(channelName, spec.name, update)

        return { id: byName.id, name: spec.name, changed: true }
      }

      return { id: byName.id, name: spec.name, changed: false }
    }

    const added = this.channels.addConnector(channelName, {
      type: "slack",
      name: spec.name,
      ...update,
      ...(spec.minify !== undefined ? { minify: spec.minify } : {}),
    })

    return { id: added.id, name: spec.name, changed: true }
  }

  private async ensureDiscord(
    channelName: string,
    spec: Extract<ConnectorSpec, { type: "discord" }>,
    dotenv: Record<string, string>,
  ): Promise<EnsureOutcome> {
    const byName = this.findExistingDiscord(channelName, spec.name)

    const bot = await this.resolveSlot({
      literal: spec.botToken,
      envVar: spec.env?.botToken,
      dotenv,
      label: `${spec.name}.botToken`,
      existingLiteral: byName?.botToken,
      existingEnv: byName?.botTokenEnv,
    })

    const update = { botToken: bot.token, botTokenEnv: bot.tokenEnv }

    if (byName) {
      if (byName.botToken !== bot.token || byName.botTokenEnv !== bot.tokenEnv) {
        this.channels.updateDiscordConnector(channelName, spec.name, update)

        return { id: byName.id, name: spec.name, changed: true }
      }

      return { id: byName.id, name: spec.name, changed: false }
    }

    const added = this.channels.addConnector(channelName, {
      type: "discord",
      name: spec.name,
      ...update,
    })

    return { id: added.id, name: spec.name, changed: true }
  }

  private ensureGh(
    channelName: string,
    spec: Extract<ConnectorSpec, { type: "gh" }>,
  ): EnsureOutcome {
    const existing = this.channels.getConnector(channelName, spec.name)

    if (existing && existing.type !== "gh") {
      throw new Error(
        `connector "${spec.name}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "gh"`,
      )
    }

    if (existing && existing.type === "gh") {
      if (spec.pollInterval !== undefined && existing.pollInterval !== spec.pollInterval) {
        this.channels.updateGhConnector(channelName, spec.name, { pollInterval: spec.pollInterval })

        return { id: existing.id, name: spec.name, changed: true }
      }

      return { id: existing.id, name: spec.name, changed: false }
    }

    const added = this.channels.addConnector(channelName, {
      type: "gh",
      name: spec.name,
      ...(spec.pollInterval !== undefined ? { pollInterval: spec.pollInterval } : {}),
    })

    return { id: added.id, name: spec.name, changed: true }
  }

  private ensureSchedule(
    channelName: string,
    spec: Extract<ConnectorSpec, { type: "schedule" }>,
  ): EnsureOutcome {
    const existing = this.channels.getConnector(channelName, spec.name)

    if (existing && existing.type !== "schedule") {
      throw new Error(
        `connector "${spec.name}" exists in channel "${channelName}" with type "${existing.type}", funnel.json declares "schedule"`,
      )
    }

    if (existing && existing.type === "schedule") {
      return { id: existing.id, name: spec.name, changed: false }
    }

    const added = this.channels.addConnector(channelName, { type: "schedule", name: spec.name })

    return { id: added.id, name: spec.name, changed: true }
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

  private removeExtras(channelName: string, touched: Set<string>): string[] {
    const channel = this.channels.get(channelName)

    if (!channel) return []

    const stale = channel.connectors.filter((c) => !touched.has(c.id))

    for (const connector of stale) {
      this.channels.removeConnector(channelName, connector.name)
    }

    return stale.map((c) => c.name)
  }

  /**
   * Decides how a single token slot is stored in settings.json:
   *
   *   - `env.<field>` reference → `{ tokenEnv: "<VAR>" }`; the secret is NOT
   *     resolved into settings, it stays in the environment / `.env.local` and
   *     the listener resolves it at start. We still assert the var is set so a
   *     typo fails loudly here instead of as a dead listener later.
   *   - literal → `{ token: "<secret>" }`.
   *   - neither, but a prior value exists → carry it over verbatim (whichever
   *     form it already was), so a tokenless re-sync is a no-op.
   *   - nothing at all → prompt for a literal (TTY only; throws otherwise).
   */
  private async resolveSlot(input: {
    literal: string | undefined
    envVar: string | undefined
    dotenv: Record<string, string>
    label: string
    existingLiteral: string | undefined
    existingEnv: string | undefined
  }): Promise<{ token: string | undefined; tokenEnv: string | undefined }> {
    if (input.literal !== undefined && input.envVar !== undefined) {
      throw new Error(
        `${input.label} is set both as a literal and as env.${input.label.split(".").pop()}; pick one`,
      )
    }

    if (input.envVar !== undefined && input.envVar !== "") {
      if (!this.env[input.envVar] && !input.dotenv[input.envVar]) {
        throw new Error(
          `${input.label} references env var "${input.envVar}" but it is not set in process env or .env.local`,
        )
      }

      return { token: undefined, tokenEnv: input.envVar }
    }

    if (input.literal !== undefined && input.literal !== "") {
      return { token: input.literal, tokenEnv: undefined }
    }

    if (input.existingEnv !== undefined) return { token: undefined, tokenEnv: input.existingEnv }
    if (input.existingLiteral !== undefined) {
      return { token: input.existingLiteral, tokenEnv: undefined }
    }

    return { token: await this.prompter.promptSecret(input.label), tokenEnv: undefined }
  }
}
