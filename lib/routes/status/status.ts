import { z } from "zod"
import { factory } from "@/factory"
import { zValidator } from "@/modules/router/validator"
import { help } from "@/routes/status/status.help"

type GatewayStatus = {
  ok: boolean
  clients: { channel: string; connectors: string[] }[]
}

export const statusHandler = factory.createHandlers(
  zValidator("query", z.object({}), help),
  async (c) => {
    const funnel = c.var.funnel
    const connectors = funnel.connectors.list()
    const channels = funnel.channels.list()
    const agents = funnel.agents.list()
    const repos = funnel.repositories.list()
    const gatewayStatus = funnel.gateway.getStatus()

    const lines: string[] = []

    lines.push("= funnel status =")
    lines.push("")

    lines.push(`connectors: ${connectors.length}`)
    for (const con of connectors) {
      lines.push(`  - ${con.name} (${con.type})`)
    }
    lines.push("")

    lines.push(`channels: ${channels.length}`)
    for (const ch of channels) {
      const attached = ch.connectors.length > 0 ? ch.connectors.join(", ") : "(none)"
      lines.push(`  - ${ch.name} [${attached}]`)
    }
    lines.push("")

    lines.push(`agents: ${agents.length}`)
    for (const agent of agents) {
      const parts = [`channel=${agent.channel}`]

      if (agent.repo) parts.push(`repo=${agent.repo}`)
      if (agent.subAgent) parts.push(`subAgent=${agent.subAgent}`)

      lines.push(`  - ${agent.name} [${parts.join(", ")}]`)
    }
    lines.push("")

    lines.push(`repos: ${repos.length}`)
    for (const repo of repos) {
      lines.push(`  - ${repo.name}  ${repo.path}`)
    }
    lines.push("")

    if (!gatewayStatus.running) {
      lines.push("gateway: not running")
    } else {
      lines.push(`gateway: running (pid ${gatewayStatus.pid}, port ${gatewayStatus.port})`)

      const res = await fetch(`http://localhost:${gatewayStatus.port}/status`).catch(() => null)

      if (res && res.ok) {
        const body = (await res.json()) as GatewayStatus
        lines.push(`  clients: ${body.clients.length}`)

        for (const client of body.clients) {
          const connectorList =
            client.connectors.length > 0 ? client.connectors.join(", ") : "(none)"
          lines.push(`    - channel=${client.channel || "(unset)"} [${connectorList}]`)
        }
      }
    }

    return c.text(lines.join("\n"))
  },
)
