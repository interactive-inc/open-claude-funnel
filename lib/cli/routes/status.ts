import { z } from "zod"
import { factory } from "@/cli/factory"
import { zValidator } from "@/cli/router/validator"

export const statusHelp = `funnel status — show overall connection status

usage: funnel status

Lists configured connectors / channels / profiles, gateway running status,
and active MCP WebSocket clients.`

type GatewayClient = { channel: string; connectors: string[] }

type GatewayStatus = {
  ok: boolean
  clients: GatewayClient[]
}

const isGatewayStatus = (value: unknown): value is GatewayStatus => {
  if (value === null || typeof value !== "object") return false
  if (!("clients" in value) || !Array.isArray(value.clients)) return false

  return value.clients.every(
    (client: unknown) =>
      typeof client === "object" &&
      client !== null &&
      "channel" in client &&
      typeof client.channel === "string" &&
      "connectors" in client &&
      Array.isArray(client.connectors),
  )
}

export const statusHandler = factory.createHandlers(
  zValidator("query", z.object({}), statusHelp),
  async (c) => {
    const funnel = c.var.funnel
    const channels = funnel.channels.list()
    const profiles = funnel.profiles.list()
    const gatewayStatus = funnel.gateway.getStatus()

    const lines: string[] = []

    lines.push("= funnel status =")
    lines.push("")

    lines.push(`channels: ${channels.length}`)
    for (const ch of channels) {
      const attached =
        ch.connectors.length > 0
          ? ch.connectors.map((c) => `${c.name}:${c.type}`).join(", ")
          : "(none)"
      lines.push(`  - ${ch.name} [${attached}]`)
    }
    lines.push("")

    lines.push(`profiles: ${profiles.length}`)
    for (const [index, profile] of profiles.entries()) {
      const tag = index === 0 ? " (default)" : ""
      const channel = funnel.channels.getById(profile.channelId)
      const channelLabel = channel ? channel.name : `id:${profile.channelId}`

      lines.push(
        `  - ${profile.name}${tag} [path=${profile.path}, channel=${channelLabel}]`,
      )
    }
    lines.push("")

    if (!gatewayStatus.running) {
      lines.push("gateway: not running")
    } else {
      lines.push(`gateway: running (pid ${gatewayStatus.pid}, port ${gatewayStatus.port})`)

      const res = await fetch(`http://127.0.0.1:${gatewayStatus.port}/status`).catch(() => null)

      if (res && res.ok) {
        const body: unknown = await res.json()

        if (isGatewayStatus(body)) {
          lines.push(`  clients: ${body.clients.length}`)

          for (const client of body.clients) {
            const connectorList =
              client.connectors.length > 0 ? client.connectors.join(", ") : "(none)"
            lines.push(`    - channel=${client.channel || "(unset)"} [${connectorList}]`)
          }
        }
      }
    }

    return c.text(lines.join("\n"))
  },
)
