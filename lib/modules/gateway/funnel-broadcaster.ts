import type { ServerWebSocket } from "bun"

type ClientData = {
  channel: string
  connectors: string[]
}

export class FunnelBroadcaster {
  private readonly clients: Map<ServerWebSocket<unknown>, ClientData> = new Map()

  addClient(ws: ServerWebSocket<unknown>, data: ClientData): void {
    this.clients.set(ws, data)
  }

  removeClient(ws: ServerWebSocket<unknown>): void {
    this.clients.delete(ws)
  }

  getClientCount(): number {
    return this.clients.size
  }

  listChannels(): { channel: string; connectors: string[] }[] {
    return [...this.clients.values()].map((d) => ({ ...d }))
  }

  broadcast(content: string, meta?: Record<string, string>): void {
    const payload = JSON.stringify({ content, meta })
    const connector = meta?.connector

    for (const [ws, data] of this.clients) {
      if (connector && !data.connectors.includes(connector)) continue

      ws.send(payload)
    }
  }
}
