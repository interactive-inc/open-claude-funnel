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

const ENV_REFERENCE = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/

type Resolution =
  | { kind: "value"; value: string }
  | { kind: "absent" }
  | { kind: "unresolved"; varName: string }

const classify = (
  raw: string | undefined,
  env: NodeJS.ProcessEnv,
  dotenv: Record<string, string>,
): Resolution => {
  if (raw === undefined || raw === "") return { kind: "absent" }

  const match = raw.match(ENV_REFERENCE)

  if (!match || !match[1]) return { kind: "value", value: raw }

  const varName = match[1]
  const fromProcessEnv = env[varName]

  if (fromProcessEnv) return { kind: "value", value: fromProcessEnv }

  const fromDotenv = dotenv[varName]

  if (fromDotenv) return { kind: "value", value: fromDotenv }

  return { kind: "unresolved", varName }
}

/**
 * Reconciles a funnel.json spec with `~/.funnel/settings.json`. Creates the
 * channel and any missing connectors, resolves token fields from $VAR / .env.local
 * / prompt, and updates existing connectors when funnel.json declares a fresh
 * token value (literal or resolved $VAR). Existing connectors that funnel.json
 * does not mention are left alone — the spec is additive.
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
      const botToken = await this.resolveToken(
        spec.botToken,
        dotenv,
        `${spec.name}.botToken`,
        existing?.type === "slack" ? existing.botToken : undefined,
      )
      const appToken = await this.resolveToken(
        spec.appToken,
        dotenv,
        `${spec.name}.appToken`,
        existing?.type === "slack" ? existing.appToken : undefined,
      )

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
      const botToken = await this.resolveToken(
        spec.botToken,
        dotenv,
        `${spec.name}.botToken`,
        existing?.type === "discord" ? existing.botToken : undefined,
      )

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

  private async resolveToken(
    raw: string | undefined,
    dotenv: Record<string, string>,
    label: string,
    existing: string | undefined,
  ): Promise<string> {
    const resolution = classify(raw, this.env, dotenv)

    if (resolution.kind === "value") return resolution.value

    if (resolution.kind === "unresolved") {
      throw new Error(
        `${label} references $${resolution.varName} but it is not set in env or .env.local`,
      )
    }

    if (existing) return existing

    return await this.prompter.promptSecret(label)
  }
}
